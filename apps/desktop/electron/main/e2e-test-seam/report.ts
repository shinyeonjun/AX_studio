import {
  buildTableArtifact,
  defaultPythonPath,
  HttpConnector,
  setDocumentEngineClient,
  StdioDocumentEngineClient,
  type Connector,
} from '@ax-studio/core';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { E2EChatReply, E2EChatRequest } from './contracts.js';

type BenchmarkCaseModules = {
  caseById(id: string): {
    id: string;
    goal: string;
    [key: string]: unknown;
  } | undefined;
};

type RdbFixtureModule = {
  createRdbFixture(
    benchmarkCase: NonNullable<ReturnType<BenchmarkCaseModules['caseById']>>,
    buildTable: typeof buildTableArtifact,
  ): Connector & { calls: unknown[] };
};

type ReportRuntimeSelection = {
  runs: Array<{ phase: 'failure' | 'retry'; pythonPath: string; override: string | null }>;
};

type E2EReportGlobal = typeof globalThis & {
  __axE2EReportRuntimeSelection?: ReportRuntimeSelection;
  __axE2EReportCleanup?: () => void;
};

function reply(content: string): E2EChatReply {
  return { content, changedWorkflowIds: [], removedWorkflowIds: [], inputRequests: [], presentations: [] };
}

async function loadBenchmarkCase(caseId: string) {
  const casesUrl = pathToFileURL(join(process.cwd(), 'test', 'report-generation-e2e', 'cases.mjs')).href;
  const cases = await import(casesUrl) as BenchmarkCaseModules;
  const benchmarkCase = cases.caseById(caseId);
  if (!benchmarkCase) throw new Error('e2e_report_case_unknown:' + caseId);
  return benchmarkCase;
}

/**
 * Deterministic report E2E seam. It still submits report.generate through the
 * real command service, document connector, report service, and Python worker.
 * Source providers are a local HTTP fixture and an in-process RDB fixture.
 */
export async function runE2EReportGeneration(
  request: E2EChatRequest,
  phase: 'failure' | 'retry',
): Promise<E2EChatReply> {
  const sessionId = request.workspaceSessionId?.trim();
  if (!sessionId) return reply('E2E report_session_missing');

  const caseId = process.env.AX_E2E_REPORT_CASE?.trim() || 'complete-api-db-report';
  const benchmarkCase = await loadBenchmarkCase(caseId);
  const sources = request.core.workspaceSources.list(sessionId).filter((source) => source.status === 'ready');
  const template = sources.find((source) => source.fileName.toLowerCase() === 'template.pdf');
  const example = sources.find((source) => source.fileName.toLowerCase() === 'example.pdf');
  if (!template || !example) return reply('E2E report_sources_not_ready');

  const baseUrl = process.env.AX_E2E_REPORT_HTTP_BASE_URL?.trim();
  if (!baseUrl || new URL(baseUrl).hostname !== '127.0.0.1') {
    throw new Error('e2e_report_local_http_fixture_required');
  }

  if (phase === 'retry') delete process.env.AX_DOCUMENT_ENGINE_PYTHON;
  setDocumentEngineClient(new StdioDocumentEngineClient());
  const selection = (globalThis as E2EReportGlobal).__axE2EReportRuntimeSelection ?? { runs: [] };
  selection.runs.push({
    phase,
    pythonPath: defaultPythonPath(),
    override: process.env.AX_DOCUMENT_ENGINE_PYTHON ?? null,
  });
  (globalThis as E2EReportGlobal).__axE2EReportRuntimeSelection = selection;

  const httpEndpoint = {
    id: 'orders-api',
    label: 'Local Orders Fixture',
    baseUrl,
    auth: { type: 'none' as const },
  };
  const rdbConfig = { type: 'fixture', database: 'local' };
  request.core.store.setConnection('http', true, { endpoints: [httpEndpoint] });
  request.core.store.setConnection('rdb', true, rdbConfig);
  request.core.runtime.setConnector('http', new HttpConnector(httpEndpoint));
  const fixturesUrl = pathToFileURL(join(process.cwd(), 'test', 'report-generation-e2e', 'fixtures.mjs')).href;
  const fixtures = await import(fixturesUrl) as RdbFixtureModule;
  const rdb = fixtures.createRdbFixture(benchmarkCase, buildTableArtifact);
  request.core.runtime.setConnector('rdb', rdb);

  (globalThis as E2EReportGlobal).__axE2EReportCleanup = () => {
    request.core.store.setConnection('http', false, { endpoints: [httpEndpoint] });
    request.core.store.setConnection('rdb', false, rdbConfig);
  request.core.runtime.setConnector('http', null);
  request.core.runtime.setConnector('rdb', null);
  };

  const result = await request.core.commandService.execute({
    name: 'report.generate',
    args: {
      goal: benchmarkCase.goal,
      templateSourceId: template.id,
      exampleSourceId: example.id,
    },
  }, {
    executionContext: { origin: 'agent' },
    workspaceSessionId: sessionId,
    userMessage: phase === 'retry' ? 'retry report' : 'generate report',
  });
  return reply('E2E report_command_' + result.status);
}
