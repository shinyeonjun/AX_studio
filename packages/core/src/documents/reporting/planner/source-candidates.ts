import { decisionProviderRequestCountFromError, type DecisionEngine, type DecisionQuestion } from '../../../contracts/decision.js';
import type { ExecutionLogEntry } from '../../../connectors/types.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { DECISION_CONTEXT_UNTRUSTED_DATA_POLICY, boundDecisionString } from '../../../intelligence/decision/context.js';
import { normalizeReportHttpPath } from '../source/schema.js';
import type { ReportSourceNeed } from './schema.js';
import type { ReportFileSummary, ReportHttpConnectionSummary } from './catalog.js';
import { inspectReportCatalog } from './catalog.js';
import type { ReportSourceInspection } from './source-discovery.js';

type CandidateInspection = Extract<ReportSourceInspection, { kind: 'http_operation' | 'rdb_table' | 'file_sheet' }>;
type CandidateRequest = CandidateInspection | Extract<ReportSourceInspection, { kind: 'http_connection' }>;
export type ReportSourceCandidateRequest = CandidateRequest;

interface Candidate {
  inspection: CandidateInspection;
  metadata: Record<string, unknown>;
}

export interface ReportSourceEvidence {
  request: ReportSourceInspection;
  result: unknown;
}

const RDB_METADATA_CONCURRENCY = 4;
/** Files offered to Jev at once, newest first; the catalog still lists every one. */
const MAX_FILE_CANDIDATES = 60;
const REPORT_PATH_ORIGIN = 'http://report-probe.invalid';

export function reportSourceCandidateKey(request: CandidateRequest): string {
  if (request.kind === 'rdb_table') return JSON.stringify(['rdb', request.table]);
  if (request.kind === 'file_sheet') return JSON.stringify(['file', request.folderId, request.path, request.sheet ?? null]);
  const path = normalizeReportHttpPath(request.path);
  return JSON.stringify(['http', request.connectionId, new URL(path, REPORT_PATH_ORIGIN).pathname]);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' });
}

function fileCandidate(file: ReportFileSummary, sheet?: string): Candidate {
  return {
    inspection: { kind: 'file_sheet', folderId: file.folderId, path: file.path, ...(sheet ? { sheet } : {}) },
    metadata: { connector: 'file', folder: boundDecisionString(file.folderLabel, 300), path: boundDecisionString(file.path, 500),
      ...(file.modifiedAt ? { modifiedAt: file.modifiedAt } : {}) },
  };
}

function reportSourceCandidates(
  requirements: ReportSourceNeed[],
  httpConnections: ReportHttpConnectionSummary[],
  rdbTables: string[],
  canInspectRdb: boolean,
  requested?: readonly CandidateRequest[],
  files: ReportFileSummary[] = [],
): Candidate[] {
  const required = new Set(requirements.map(need => need.connector));
  const candidates: Candidate[] = [];
  if (required.has('http')) {
    for (const connection of httpConnections) {
      for (const operation of connection.operations ?? []) {
        if (operation.method !== 'GET' || operation.sideEffect !== 'NONE') continue;
        let path: string;
        try {
          path = normalizeReportHttpPath(operation.path);
        } catch {
          continue;
        }
        const response = operation.responses?.find(item => item.status.startsWith('2'));
        candidates.push({
          inspection: { kind: 'http_operation', connectionId: connection.id, path },
          metadata: {
            connector: 'http', connection: boundDecisionString(connection.label, 300),
            operationId: boundDecisionString(operation.operationId, 160), path,
            ...(operation.summary ? { summary: boundDecisionString(operation.summary, 500) } : {}),
            parameters: (operation.parameters ?? []).filter(item => item.in === 'path' || item.in === 'query')
              .map(item => ({ name: item.name, in: item.in, ...(item.description ? { description: item.description } : {}) })),
            // This is a discovery hint only; full operation metadata remains available to the existing paged flow.
            responseFields: (response?.fields ?? []).slice(0, 32).map(field => ({
              name: field.name, ...(field.description ? { description: field.description } : {}),
            })),
          },
        });
      }
    }
  }
  if (canInspectRdb && required.has('rdb')) {
    for (const table of new Set(rdbTables)) {
      candidates.push({ inspection: { kind: 'rdb_table', table }, metadata: { connector: 'rdb', table } });
    }
  }
  if (canInspectRdb && required.has('file')) {
    const newest = [...files].sort((left, right) => (right.modifiedAt ?? '').localeCompare(left.modifiedAt ?? ''))
      .slice(0, MAX_FILE_CANDIDATES);
    for (const file of newest) candidates.push(fileCandidate(file));
  }
  if (!requested) return candidates;
  const byKey = new Map(candidates.map(candidate => [reportSourceCandidateKey(candidate.inspection), candidate]));
  const entries = requested.map(request => {
    const key = reportSourceCandidateKey(request);
    const existing = byKey.get(key);
    if (existing) return [key, { ...existing, inspection: request.kind === 'http_connection'
      ? { kind: 'http_operation', connectionId: request.connectionId, path: request.path }
      : request } as Candidate] as const;
    if (request.kind === 'rdb_table') {
      if (!canInspectRdb || !rdbTables.includes(request.table)) return [key, undefined] as const;
      return [key, { inspection: request, metadata: { connector: 'rdb', table: request.table } } as Candidate] as const;
    }
    if (request.kind === 'file_sheet') {
      const file = files.find(item => item.folderId === request.folderId && item.path === request.path);
      if (!canInspectRdb || !file) return [key, undefined] as const;
      return [key, fileCandidate(file, request.sheet)] as const;
    }
    const connection = httpConnections.find(item => item.id === request.connectionId);
    if (!connection) return [key, undefined] as const;
    const pathname = new URL(normalizeReportHttpPath(request.path), REPORT_PATH_ORIGIN).pathname;
    const documentedOperation = connection.operations?.find(operation => operation.path === pathname);
    if (documentedOperation && (documentedOperation.method !== 'GET' || documentedOperation.sideEffect !== 'NONE')) {
      return [key, undefined] as const;
    }
    return [key, {
      inspection: request.kind === 'http_connection'
        ? { kind: 'http_operation', connectionId: request.connectionId, path: request.path }
        : request,
      metadata: { connector: 'http', connection: boundDecisionString(connection.label, 300),
        path: normalizeReportHttpPath(request.path), method: 'GET',
        evidenceKind: 'explicit path; the host still verifies it against the user request/report' },
    } as Candidate] as const;
  }).filter((entry): entry is readonly [string, Candidate] => entry[1] !== undefined);
  return [...new Map(entries).values()];
}

async function inspectSelectedRdb(
  selected: Candidate[],
  inspect: (request: ReportSourceInspection, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<Map<string, unknown>> {
  // DB tables and files are read on the host; HTTP operations are answered from the catalog.
  const tables = selected.filter((candidate): candidate is Candidate & {
    inspection: Extract<CandidateInspection, { kind: 'rdb_table' | 'file_sheet' }>;
  } => candidate.inspection.kind === 'rdb_table' || candidate.inspection.kind === 'file_sheet');
  const results = new Map<string, unknown>();
  const errors: Array<{ error: unknown } | undefined> = [];
  let next = 0;
  const worker = async () => {
    while (next < tables.length) {
      throwIfAborted(signal);
      const index = next++;
      const candidate = tables[index]!;
      try {
        results.set(JSON.stringify(candidate.inspection), await inspect(candidate.inspection.kind === 'rdb_table'
          ? { ...candidate.inspection, limit: candidate.inspection.limit ?? 20 }
          : candidate.inspection, signal));
      } catch (error) {
        errors[index] = { error };
      }
    }
  };
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(RDB_METADATA_CONCURRENCY, tables.length) }, worker),
  );
  throwIfAborted(signal);
  const workerFailure = workers.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  if (workerFailure) throw workerFailure.reason;
  const error = errors.find(value => value !== undefined);
  if (error) throw error.error;
  return results;
}

/**
 * Inspect only Jev-selected candidates. Optional requests support one batched
 * Jev recheck when the report planner proposes an alternative source.
 */
export async function selectAndInspectReportSources(input: {
  decisionEngine: DecisionEngine;
  goal: string;
  pair: PdfReportPairAnalysis;
  requirements: ReportSourceNeed[];
  httpConnections: ReportHttpConnectionSummary[];
  rdbTables: string[];
  files?: ReportFileSummary[];
  candidateRequests?: readonly CandidateRequest[];
  inspectSource?: (request: ReportSourceInspection, signal?: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
  log?: (entry: ExecutionLogEntry) => void;
}): Promise<ReportSourceEvidence[]> {
  const candidates = reportSourceCandidates(input.requirements, input.httpConnections, input.rdbTables,
    Boolean(input.inspectSource), input.candidateRequests, input.files);
  if (!candidates.length) return [];

  const questions: Record<string, DecisionQuestion> = Object.fromEntries(candidates.map((candidate, index) => [
    `source_${index}`, {
      type: 'choice',
      instructions: {
        task: 'Decide whether inspecting this configured source metadata is relevant to produce the requested report from the completed example.',
        candidate: candidate.metadata,
        policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
      },
      criteria: {
        use_source: 'This source may satisfy a stated report requirement; inspecting its schema/catalog is safe and useful.',
        skip_source: 'This source is irrelevant, redundant, or not needed; do not inspect it.',
        unclear: 'There is not enough context to decide whether this source is needed; do not inspect it yet.',
      },
    },
  ]));
  const startedAt = Date.now();
  let evaluation;
  try {
    evaluation = await input.decisionEngine.evaluate({
      state: {
        request: boundDecisionString(input.goal),
        reportShape: {
          pageCount: input.pair.pageCount,
          scalarSlotCount: input.pair.scalarSlots.length,
          tables: input.pair.tableGroups.map(group => ({ id: group.id, columnCount: group.columnCount })),
        },
        requirements: input.requirements.map(({ id, connector, description }) => ({ id, connector, description })),
        policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
      },
      questions,
      signal: input.signal,
    });
  } catch (error) {
    const providerRequestCount = decisionProviderRequestCountFromError(error);
    input.log?.({ at: new Date().toISOString(), level: input.signal?.aborted ? 'info' : 'warn',
      code: input.signal?.aborted ? 'report_source_candidates_jev_cancelled' : 'report_source_candidates_jev_failed',
      message: input.signal?.aborted ? 'Jev source candidate selection was cancelled.' : 'Jev source candidate selection failed.',
      data: { durationMs: Date.now() - startedAt,
        ...(providerRequestCount === undefined ? {} : { providerRequestCount }) } });
    if (input.signal?.aborted) throw Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' });
    throw Object.assign(new Error('report_source_candidate_jev_failed'), {
      code: 'report_source_candidate_jev_failed', cause: error,
    });
  }
  throwIfAborted(input.signal);

  const selected: Candidate[] = [];
  let uncertainCount = 0;
  for (const [index, candidate] of candidates.entries()) {
    const answer = evaluation.answers[`source_${index}`];
    const invalidReason = !answer ? 'missing'
      : answer.type !== 'choice' ? 'wrong_type'
        : !['use_source', 'skip_source', 'unclear'].includes(answer.choice) ? 'unlisted_choice'
          : undefined;
    if (invalidReason) {
      input.log?.({ at: new Date().toISOString(), level: 'warn',
        code: 'report_source_candidates_jev_answer_invalid',
        message: 'Jev returned an incomplete or invalid report source selection.',
        data: { durationMs: Date.now() - startedAt, candidateCount: candidates.length,
          candidateId: `source_${index}`, reason: invalidReason,
          providerRequestCount: evaluation.providerRequestCount ?? 1,
          ...(evaluation.model ? { model: evaluation.model } : {}),
          ...(evaluation.usage?.inputTokens === undefined ? {} : { inputTokens: evaluation.usage.inputTokens }),
          ...(evaluation.usage?.outputTokens === undefined ? {} : { outputTokens: evaluation.usage.outputTokens }) } });
      throw Object.assign(new Error('report_source_candidate_jev_answer_invalid'), {
        code: 'report_source_candidate_jev_answer_invalid',
      });
    }
    if (answer.type === 'choice' && answer.choice === 'use_source') selected.push(candidate);
    else if (answer.type === 'choice' && answer.choice === 'unclear') uncertainCount += 1;
  }
  input.log?.({ at: new Date().toISOString(), level: 'info', code: 'report_source_candidates_jev_completed',
    message: 'Jev evaluated report source metadata candidates.',
    data: { durationMs: Date.now() - startedAt, candidateCount: candidates.length, selectedCount: selected.length, uncertainCount,
      providerRequestCount: evaluation.providerRequestCount ?? 1, ...(evaluation.model ? { model: evaluation.model } : {}),
      ...(evaluation.usage?.inputTokens === undefined ? {} : { inputTokens: evaluation.usage.inputTokens }),
      ...(evaluation.usage?.outputTokens === undefined ? {} : { outputTokens: evaluation.usage.outputTokens }) } });
  if (!selected.length) return [];

  const rdbResults = input.inspectSource
    ? await inspectSelectedRdb(selected, input.inspectSource, input.signal)
    : new Map<string, unknown>();
  return selected.map(candidate => {
    if (candidate.inspection.kind === 'http_operation') {
      return { request: candidate.inspection,
        result: inspectReportCatalog(input.httpConnections, input.rdbTables, candidate.inspection) };
    }
    return { request: candidate.inspection, result: rdbResults.get(JSON.stringify(candidate.inspection)) };
  });
}
