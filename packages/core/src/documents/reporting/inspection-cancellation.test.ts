import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { InvestigationRunner, InvestigationRunRequest } from '../../intelligence/agent/investigation-runner.js';
import { buildHttpResponseArtifact } from '../../contracts/artifacts/http-response.js';
import type { ConnectorContext, ConnectorResult } from '../../connectors/types.js';
import { ReportCheckpointStore } from './checkpoints.js';
import type { DecisionEngine } from '../../contracts/decision.js';
import { ReportPlanner } from './planner/planner.js';
import { REPORT_SOURCE_DISCOVERY_TIMEOUT_MS } from './planner/source-discovery.js';
import { ReportGenerationService } from './service.js';

describe('report source inspection cancellation', () => {
  it.each(['rdb', 'http'] as const)('does not persist late %s evidence after discovery times out', async connector => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-report-inspection-cancel-'));
    vi.useFakeTimers();
    try {
      const sourcePath = join(directory, 'source.pdf');
      writeFileSync(sourcePath, 'test-source');
      const checkpoints = new ReportCheckpointStore(join(directory, 'checkpoints'));
      const writeCheckpoint = vi.spyOn(checkpoints, 'write');
      let release: (() => void) | undefined;
      let signalInspectionStarted!: () => void;
      const inspectionStarted = new Promise<void>(resolve => { signalInspectionStarted = resolve; });
      const inspect = vi.fn((_action: string, _params: Record<string, unknown>, _ctx: ConnectorContext) => {
        const pending = new Promise<ConnectorResult>(resolve => {
          release = () => resolve({ ok: true, data: connector === 'rdb' ? { columns: [{ name: 'id', type: 'integer' }] }
            : buildHttpResponseArtifact({ executionId: 'probe', url: 'https://api.test/records', status: 200,
              statusText: 'OK', headers: {}, body: '[]', truncated: false }) });
        });
        signalInspectionStarted();
        return pending;
      });
      const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
        return { output: request.outputSchema.parse({ schemaVersion: 1, status: 'need_evidence', request: connector === 'rdb'
            ? { kind: 'rdb_table', table: 'records' }
            : { kind: 'http_connection', connectionId: 'api', path: '/records' } }) };
      } };
      const decisionEngine: DecisionEngine = { async evaluate({ questions }) {
        return { answers: Object.fromEntries(Object.keys(questions).map(id => {
          const sourceCandidate = id.startsWith('source_');
          const choice = id.endsWith('_required') ? 'required' : id === 'source_0' ? 'use_source' : 'skip_source';
          return [id, { type: 'choice' as const, choice,
            probabilities: sourceCandidate ? { use_source: 0.4, skip_source: 0.35, unclear: 0.25 }
              : { required: 0.4, not_required: 0.35, unclear: 0.25 }, confidence: 0.4 }];
        })) };
      } };
      const service = new ReportGenerationService({ checkpoints,
        workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: sourcePath } }) },
        documentEngine: { pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
          pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }), pdfFormFill: vi.fn() },
        planner: new ReportPlanner(runner, { decisionEngine }),
        getConnector: name => name === 'rdb' ? { name, execute: async (action, params, ctx) => action === 'schema.describe'
          ? { ok: true, data: ['records'] } : inspect(action, params, ctx) }
          : name === 'http' ? { name, execute: inspect } : undefined,
      });
      const result = service.generate({ goal: 'Use the records source at /records', templateSourceId: 't', exampleSourceId: 'e' }, {
        executionId: 'deadline', workspaceSessionId: 'session', variables: {}, log: vi.fn(), artifactSink: { putBytes: vi.fn() },
        connections: [{ connector: 'http', connected: true, config: { endpoints: [{ id: 'api', baseUrl: 'https://api.test' }] } }],
      });
      await inspectionStarted;
      await vi.advanceTimersByTimeAsync(REPORT_SOURCE_DISCOVERY_TIMEOUT_MS + 1);
      expect(await result).toMatchObject({ ok: false, errorCode: 'report_source_discovery_deadline' });
      expect(inspect).toHaveBeenCalledTimes(1);
      const writesAtFailure = writeCheckpoint.mock.calls.length;
      const savedAtFailure = checkpoints.read('session', 'deadline');
      release!();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeCheckpoint).toHaveBeenCalledTimes(writesAtFailure);
      expect(checkpoints.read('session', 'deadline')).toEqual(savedAtFailure);
      expect(inspect.mock.calls[0]![2].abortSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
