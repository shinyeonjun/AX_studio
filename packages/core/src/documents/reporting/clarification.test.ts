import { expect, it, vi } from 'vitest';
import type { InvestigationRunner } from '../../intelligence/agent/investigation-runner.js';
import type { ExecutionLogEntry } from '../../connectors/types.js';
import { formatExecutionResultMessage } from '../../runtime/execution-result/format.js';
import { ReportPlanner } from './planner/planner.js';
import { ReportGenerationService } from './service.js';

it.each(['어느 기간을 이번 달로 볼까요?', '연결 A와 B 중 어떤 자료가 기준인가요?'])('preserves the clarification question: %s', question => {
  return (async () => {
    const runner: InvestigationRunner = { providerName: 'test', async run(request) {
      return { output: request.outputSchema.parse(request.logContext === 'report-source-requirements'
        ? { schemaVersion: 1, requirements: [] }
        : { schemaVersion: 1, status: 'needs_input', reason: question }) };
    } };
    const log: ExecutionLogEntry[] = [];
    const fill = vi.fn();
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
      documentEngine: { pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
        pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }), pdfFormFill: fill },
      planner: new ReportPlanner(runner), getConnector: () => undefined,
    });
    const result = await service.generate({ goal: '지난번처럼 해줘', templateSourceId: 't', exampleSourceId: 'e' }, {
      executionId: 'run', variables: {}, workspaceSessionId: 'chat', artifactSink: { putBytes: vi.fn() }, log: entry => log.push(entry),
    });
    expect(result.errorCode).toBe('report_source_discovery_needs_input');
    expect(formatExecutionResultMessage({ executionId: 'run', status: 'failed', errorCode: result.errorCode, log })).toContain(question);
    expect(fill).not.toHaveBeenCalled();
  })();
});
