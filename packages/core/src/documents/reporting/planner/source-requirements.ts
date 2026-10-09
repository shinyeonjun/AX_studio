import type { DecisionEngine, DecisionQuestion } from '../../../contracts/decision.js';
import { decisionProviderRequestCountFromError } from '../../../contracts/decision.js';
import type { ExecutionLogEntry } from '../../../connectors/types.js';
import { DECISION_CONTEXT_UNTRUSTED_DATA_POLICY, boundDecisionString } from '../../../intelligence/decision/context.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { ReportSourceRequirementsSchema, type ReportSourceNeed, type ReportUnavailableSource } from './schema.js';
import { ReportSourceClarificationRequired } from './source-discovery.js';

/** Names per source offered to the decision; the full catalog stays with the later discovery. */
const MAX_SOURCE_NAMES = 40;

export interface ReportSourceRequirementsInput {
  goal: string;
  pair: PdfReportPairAnalysis;
  connectedConnectors: string[];
  /**
   * What each connected source holds, by name only: API connection labels, DB table names, folder
   * file paths. Without them a decision cannot tell that 주문내역_2026-08.xlsx feeds a sales report.
   */
  sourceNames?: Partial<Record<'http' | 'rdb' | 'file', readonly string[]>>;
  unavailableSources?: ReportUnavailableSource[];
  signal?: AbortSignal;
  log?: (entry: ExecutionLogEntry) => void;
}

/**
 * Let Jev choose which connected source types (HTTP, DB) the report needs
 * before any catalog discovery. Only geometry counts reach the decision, not
 * example values; an unclear answer asks the user instead of guessing.
 */
export async function inferReportSourceRequirements(
  decisionEngine: DecisionEngine | undefined,
  input: ReportSourceRequirementsInput,
): Promise<ReportSourceNeed[]> {
  if (!decisionEngine) throw Object.assign(new Error('report_source_jev_unavailable'), {
    code: 'report_source_jev_unavailable',
  });

  const available = new Set(input.connectedConnectors);
  const connectorOptions = (['http', 'rdb', 'file'] as const).filter(connector => available.has(connector));
  if (connectorOptions.length === 0) {
    throw new ReportSourceClarificationRequired('보고서에 쓸 데이터 연결이 없습니다. 설정에서 API, 데이터베이스, 또는 엑셀·CSV 파일이 있는 폴더를 연결해 주세요.');
  }
  const questions: Record<string, DecisionQuestion> = Object.fromEntries(connectorOptions.map(connector => [
    `${connector}_required`, {
      type: 'choice' as const,
      instructions: {
        task: 'Determine whether this connected data source is required to satisfy the report request and reproduce the completed example.',
        connector,
        ...(input.sourceNames?.[connector]?.length ? { contains: input.sourceNames[connector]!.slice(0, MAX_SOURCE_NAMES)
          .map((name) => boundDecisionString(name, 160)) } : {}),
        policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
      },
      criteria: {
        required: 'This connected data source is needed to satisfy the report request or reproduce its example.',
        not_required: 'This connected data source is not needed for the report request or example.',
        unclear: 'There is not enough information to decide whether this connected data source is needed.',
      },
    },
  ]));
  // This decision only chooses connector types. Keep example PDF values out
  // of the Jev request; the later report planner receives them only when
  // calculation/replay actually requires them.
  const geometry = JSON.stringify({
    scalarSlotCount: input.pair.scalarSlots.length,
    tableGroups: input.pair.tableGroups.map(group => ({
      columnCount: group.columnCount,
      rowCount: group.rowCount,
    })),
  });
  const startedAt = Date.now();
  let evaluation;
  try {
    evaluation = await decisionEngine.evaluate({
      state: {
        request: boundDecisionString(input.goal),
        reportEvidence: boundDecisionString(geometry, 16_000),
        availableConnectors: connectorOptions,
        unavailableSources: input.unavailableSources ?? [],
        policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
      },
      questions,
      signal: input.signal,
    });
  } catch (error) {
    const providerRequestCount = decisionProviderRequestCountFromError(error);
    input.log?.({ at: new Date().toISOString(), level: input.signal?.aborted ? 'info' : 'warn',
      code: input.signal?.aborted ? 'report_source_requirements_jev_cancelled' : 'report_source_requirements_jev_failed',
      message: input.signal?.aborted ? 'Jev source requirement selection was cancelled.' : 'Jev source requirement selection failed.',
      data: { durationMs: Date.now() - startedAt,
        ...(providerRequestCount === undefined ? {} : { providerRequestCount }) } });
    if (input.signal?.aborted) throw Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' });
    throw Object.assign(new Error('report_source_jev_failed'), {
      code: 'report_source_jev_failed',
      cause: error,
    });
  }
  input.log?.({ at: new Date().toISOString(), level: 'info', code: 'report_source_requirements_jev_completed',
    message: 'Jev selected the required report data source types.',
    data: { durationMs: Date.now() - startedAt, candidateCount: connectorOptions.length,
      selectedCount: Object.values(evaluation.answers).filter(answer => answer.type === 'choice'
        && answer.choice === 'required').length,
      providerRequestCount: evaluation.providerRequestCount ?? 1,
      ...(evaluation.model ? { model: evaluation.model } : {}),
      ...(evaluation.usage?.inputTokens === undefined ? {} : { inputTokens: evaluation.usage.inputTokens }),
      ...(evaluation.usage?.outputTokens === undefined ? {} : { outputTokens: evaluation.usage.outputTokens }) } });

  const requirements: ReportSourceNeed[] = [];
  for (const connector of connectorOptions) {
    const answer = evaluation.answers[`${connector}_required`];
    if (answer?.type !== 'choice' || !['required', 'not_required', 'unclear'].includes(answer.choice)) {
      throw Object.assign(new Error('report_source_jev_answer_invalid'), { code: 'report_source_jev_answer_invalid' });
    }
    const label = connector === 'http' ? 'HTTP API' : connector === 'rdb' ? '데이터베이스' : '폴더의 엑셀·CSV 파일';
    if (answer.choice === 'required') {
      requirements.push({
        id: `source-${connector}`,
        connector,
        description: `보고서 요청과 완성 예시에 필요한 ${label} 데이터`,
        reason: 'Jev selected this connected source type from the user request and report evidence.',
      });
    } else if (answer.choice === 'unclear') {
      throw new ReportSourceClarificationRequired(`이번 보고서에 ${label} 연결을 사용해야 하는지 분명하지 않습니다. 사용할 연결 종류를 지정해 주세요.`);
    }
  }
  if (requirements.length === 0) {
    throw new ReportSourceClarificationRequired('보고서에 사용할 연결 데이터가 분명하지 않습니다. 어떤 API, 데이터베이스, 또는 폴더의 파일을 쓸지 알려 주세요.');
  }
  return ReportSourceRequirementsSchema.parse({ schemaVersion: 1, requirements }).requirements;
}
