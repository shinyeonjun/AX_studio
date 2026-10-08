import type { DecisionEngine } from '../../../../../contracts/decision.js';
import { TRANSFORM_CAPABILITIES } from '../../../../../connectors/transform/catalog.js';
import { TableArtifactSchema } from '../../../../../contracts/artifacts/table.js';
import type { AxCommand } from '../../schema.js';
import { validateJevPlan } from './plan-contract.js';
import { DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../../decision/context.js';

/** A single supported module over the exact host-held previous table, never a model-built payload. */
export async function planPreviousTableExport(input: {
  table: unknown; request: string; decisionEngine: DecisionEngine; signal?: AbortSignal;
}): Promise<{ command?: AxCommand; message?: string; evaluationCalls: number; providerRequestCount: number;
  requestBytes?: number; usage?: { inputTokens?: number; outputTokens?: number } }> {
  input.signal?.throwIfAborted();
  const table = TableArtifactSchema.safeParse(input.table);
  const capability = TRANSFORM_CAPABILITIES.find(c => c.id === 'transform.table_to_xlsx')!;
  if (!table.success || !validateJevPlan([{ id: 'export', capability, params: { table: table.data }, bindings: {} }], []).ok) {
    return { message: '이전 표의 열 구성을 확인하지 못해 파일을 만들지 않았습니다. 표를 다시 가져온 뒤 요청해 주세요.', evaluationCalls: 0, providerRequestCount: 0 };
  }
  // No cells, raw params, source paths or host-confirmed values enter final review.
  const review = await input.decisionEngine.evaluate({
    state: { request: input.request, policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
      plan: { operation: capability.id, input: 'exact current table, preserving rows and order',
        output: 'xlsx artifact in host storage', noSourceRead: true, noExternalSend: true } },
    questions: {
      requirements: { type: 'choice', instructions: 'Does exporting only the current displayed table to Excel meet the complete request? Choose missing for full-source export, extra transforms or sending.',
        criteria: { met: 'All requirements met', missing: 'A requirement missing', unclear: 'Unclear' } },
      scope: { type: 'choice', instructions: 'Is this exactly the requested scope? This does not authorize external actions.',
        criteria: { preserved: 'Preserved', expanded: 'Expanded', unclear: 'Unclear' } },
    }, signal: input.signal,
  });
  input.signal?.throwIfAborted();
  const metadata = { evaluationCalls: 1, providerRequestCount: review.providerRequestCount ?? 1,
    requestBytes: review.requestBytes, usage: review.usage };
  if (review.answers.requirements?.type !== 'choice' || review.answers.requirements.choice !== 'met'
    || review.answers.scope?.type !== 'choice' || review.answers.scope.choice !== 'preserved') {
    return { ...metadata, message: '현재 표만 Excel로 저장하면 되는지 확인해 주세요. 파일은 만들지 않았습니다.' };
  }
  return { ...metadata, command: { name: 'execution.enqueue_once', args: {
    name: '현재 표 Excel 저장', goal: '현재 표의 행과 순서를 그대로 Excel 파일로 저장',
    steps: [{ type: 'action', id: 'export', connector: 'transform', action: 'table_to_xlsx',
      params: { table: table.data } }],
  } } };
}
