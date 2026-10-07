import { thenTransform } from '../read-recipe.js';
import { jevUnsupportedChatReplyPrompt } from '../protocol.js';
import { boundedChatReadResult, formatTableArtifact } from '../result.js';
import { applyJevTableTransform } from '../jev-table-transform.js';
import { planPreviousTableExport } from '../jev-table-export.js';
import { httpReadPathRequiredMessage } from '../connection-selection/http-endpoint-selection.js';
import { appendAppLog } from '../../../../../persistence/paths/app-log.js';
import {
  executeScopedChatCommand,
  jevFallbackMessage,
  missingReadValuesMessage,
  partialPreviousResultCalculation,
  PARTIAL_PREVIOUS_RESULT_NOTE,
  presentHttpEndpointSelection,
} from '../loop-shared.js';
import type { JevRoute, JevTurn } from './turn.js';

export async function fallbackRoute(turn: JevTurn, route: JevRoute<'fallback'>): Promise<string> {
  const { context, requestContext } = turn;
  appendAppLog('info', 'Jev chat route could not select a supported operation.', {
    ...requestContext,
    event: 'jev_chat_route_fallback',
    reason: route.reason,
    ...('detail' in route && route.detail ? { detail: route.detail } : {}),
  });
  if (route.reason === 'http_endpoint_required') return presentHttpEndpointSelection(context);
  if (route.reason === 'http_path_required') {
    appendAppLog('info', 'Schema-less HTTP read stopped for an explicit path or OpenAPI contract.', {
      ...requestContext,
      event: 'jev_chat_http_read_path_required',
    });
    return httpReadPathRequiredMessage();
  }
  if (route.reason === 'unsupported') {
    const reply = await turn.replies.textReplyFromModel(
      'ax_command_chat_jev_unsupported',
      jevUnsupportedChatReplyPrompt(context.options),
    );
    return reply ?? jevFallbackMessage('unsupported');
  }
  return jevFallbackMessage(route.reason);
}

export async function replyRoute(turn: JevTurn): Promise<string> {
  const reply = await turn.replies.textReplyFromModel('ax_command_chat_jev_reply');
  if (!reply) return '답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  // The model only sees the bounded table text; never let a computed figure read as a full-data total.
  return partialPreviousResultCalculation(turn.context.options) ? `${reply}\n\n${PARTIAL_PREVIOUS_RESULT_NOTE}` : reply;
}

export async function previousResultRoute(turn: JevTurn): Promise<string> {
  const { context, requestContext } = turn;
  const { options, signal, publishResult } = context;
  const previousReadResult = options.previousReadResult;
  if (!previousReadResult || !options.decisionEngine) return jevFallbackMessage('missing_context');
  const transformStartedAt = Date.now();
  const transformed = await applyJevTableTransform({
    decisionEngine: options.decisionEngine,
    table: previousReadResult,
    userMessage: options.userMessage,
    mode: 'auto',
    abortSignal: signal,
  });
  appendAppLog('info', 'Jev previous-result transform decision recorded.', {
    ...requestContext,
    event: 'jev_chat_previous_result_transform',
    durationMs: Date.now() - transformStartedAt,
    status: transformed.status,
    ...(transformed.status === 'transformed' ? { rowCount: transformed.table.rows.length } : {}),
  });
  if (transformed.status === 'export_xlsx') {
    const exportPlan = await planPreviousTableExport({ table: previousReadResult,
      request: options.userMessage, decisionEngine: options.decisionEngine, signal });
    appendAppLog('info', 'Previous-table export plan checked.', { ...requestContext,
      event: 'jev_chat_table_export_plan', evaluationCalls: exportPlan.evaluationCalls,
      providerRequestCount: exportPlan.providerRequestCount, requestBytes: exportPlan.requestBytes,
      usage: exportPlan.usage, accepted: Boolean(exportPlan.command) });
    if (!exportPlan.command) return exportPlan.message!;
    options.onPresentation?.({ title: 'Excel 저장 계획 검사', inputMode: 'individual', inputs: [], actions: [],
      blocks: [{ type: 'decision', label: '입력·요구 충족·범위', value: 'Host 입력 검사 및 Jev 검토 통과' },
        { type: 'steps', title: '의존 순서', items: ['현재 표 → Excel 산출물 저장'] },
        { type: 'note', text: '실행 완료가 아닙니다. 현재 표만 저장하며 원본 재조회나 외부 발송은 하지 않습니다.' }] });
    const result = await executeScopedChatCommand(context, exportPlan.command);
    signal.throwIfAborted();
    publishResult(exportPlan.command.name, result, exportPlan.command);
    return result.status === 'queued' ? '현재 표의 Excel 저장을 실행 큐에 등록했습니다. 파일 생성 결과는 실행 결과에서 확인합니다.'
      : 'Excel 저장을 시작하지 못했습니다. 실행 결과를 확인해 주세요.';
  }
  if (transformed.status === 'clarify') return transformed.message;
  if (transformed.status === 'unavailable') {
    return '이전 결과는 유지했지만 Jev가 변환 조건을 확인하지 못해 바꾸지 않았습니다. 조건을 조금 더 구체적으로 말해 주세요.';
  }
  const table = transformed.status === 'transformed' ? transformed.table : previousReadResult;
  options.onReadResult?.(boundedChatReadResult(table));
  // Shaping an earlier answer again repeats that answer's recipe, then this shaping.
  options.onReadRecipe?.(options.previousReadRecipe && transformed.status === 'transformed'
    ? thenTransform(options.previousReadRecipe, transformed.expression)
    : options.previousReadRecipe);
  return formatTableArtifact(table);
}

export async function parameterizedRoute(turn: JevTurn, route: JevRoute<'parameterized'>): Promise<string> {
  appendAppLog('info', 'Jev selected a read operation but required values are missing.', {
    ...turn.requestContext,
    event: 'jev_chat_read_needs_input',
    capabilityId: route.plan.capabilityId,
    requiredParameterCount: route.plan.requiredParameterPaths.length,
  });
  return missingReadValuesMessage(route.plan.requiredParameterPaths);
}
