import { authoritativeRequestClarification } from '../../../../../decision/request-anchor.js';
import type { AxCommand, AxCommandResult } from '../../../schema.js';
import { hostFacingMessage } from '../../result/index.js';
import { routeChatWithJev } from '../../routing/router.js';
import { appendAppLog } from '../../../../../../persistence/paths/app-log.js';
import { chatReadAuthorizationFor, type ChatReadAuthorization } from '../read-authorization.js';
import { readAllHttpPages, withAllPages } from '../../result/http-pages.js';
import {
  executeScopedChatCommand,
  isRecoverableReadFailure,
  missingReadValuesMessage,
  readOperationIdentity,
  WORKFLOW_DELETED_REPLY,
  workflowRunReply,
  workflowUpdateSuccessMessage,
} from '../turn-context.js';
import { baseRouterInput, type JevRoute, type JevTurn } from './turn.js';
import { readProgressMessage } from './progress.js';

/** Table shapings whose answer depends on every row, not the first page. */
const WHOLE_SET_TRANSFORMS = new Set(['filter', 'sort', 'filter_sort', 'calculate']);

/** Lifecycle commands report their host status deterministically instead of via an LLM paraphrase. */
function lifecycleCommandReply(route: JevRoute<'command'>, result: AxCommandResult): string | undefined {
  const name = route.command.name;
  if (route.route === 'context_remember') return hostFacingMessage(result, '저장할 내용을 확인해 주세요. 아직 저장하지 않았습니다.');
  if (name === 'workflow.run') return workflowRunReply(result);
  if (name === 'workflow.delete' && result.status === 'ok') return WORKFLOW_DELETED_REPLY;
  if (name === 'workflow.update' && result.status === 'ok') return workflowUpdateSuccessMessage(result);
  if (name === 'job.propose') return hostFacingMessage(result, '업무 초안을 처리하지 못했습니다.');
  if (name === 'workflow.create' && result.status === 'ok') return '업무를 저장했습니다. 직접 실행할 때만 돌아가며 자동 실행은 켜지 않았습니다.';
  // A report is queued, not finished: say what happens next instead of reading "queued" as a failure.
  if (name === 'report.generate') {
    return result.status === 'queued' || result.status === 'ok'
      ? '보고서를 만들기 시작했어요. 지난 보고서에서 바뀌는 값을 찾고, 연결된 자료에서 그 숫자를 다시 계산해 맞는지 확인한 뒤 이번 기간 PDF를 만듭니다. 몇 분 걸릴 수 있고, 끝나면 결과 카드로 알려 드려요.'
      : hostFacingMessage(result, '보고서 작업을 시작하지 못했습니다.');
  }
  if (name === 'execution.enqueue_once' && (result.status === 'ok' || result.status === 'queued')) {
    return hostFacingMessage(result, '요청한 작업을 시작했습니다. 진행 상황은 결과 카드에서 볼 수 있어요.');
  }
  return undefined;
}

interface CompletedRead {
  command: AxCommand;
  result: AxCommandResult;
  route: Pick<JevRoute<'command'>, 'tableTransform' | 'tableProjection' | 'readResultStyle'>;
}

/**
 * After a recoverable read failure, Jev may choose a different cataloged read.
 * Each candidate runs at most once and only with a catalog-backed authorization.
 */
async function recoverFailedRead(
  turn: JevTurn,
  initialRead: ChatReadAuthorization,
  completed: CompletedRead,
): Promise<CompletedRead | string> {
  const { context, catalog, requestContext } = turn;
  const { options, signal, publishResult } = context;
  const attempted = new Set<string>();
  const initialIdentity = readOperationIdentity(initialRead.capabilityId, initialRead.params);
  if (initialIdentity) attempted.add(initialIdentity);
  let failedCapabilityId = initialRead.capabilityId;
  let current = completed;

  while (isRecoverableReadFailure(current.result)) {
    signal.throwIfAborted();
    const failedResult = current.result;
    const failureKind = failedResult.issues.find((item) => item.failureKind)?.failureKind;
    const remainingHints = (catalog.hints ?? []).filter((hint) => {
      const identity = readOperationIdentity(hint.capabilityId, hint.params);
      return identity !== undefined && !attempted.has(identity);
    });
    if (remainingHints.length === 0) break;

    const recoveryStartedAt = Date.now();
    const recovery = await routeChatWithJev({
      ...baseRouterInput(context),
      readOperationHints: remainingHints,
      readOperationCatalogSize: remainingHints.length,
      readOperationCatalogMayBeBounded: catalog.mayBeBounded === true
        || remainingHints.length < (catalog.hints?.length ?? 0),
      readOperationSelectionMode: 'prepared_candidates',
      readRecoveryContext: {
        failedCapabilityId,
        status: failedResult.status,
        ...(failureKind ? { failureKind } : {}),
      },
    });
    signal.throwIfAborted();
    const recoveryAuthorization = recovery.kind === 'command' && recovery.route === 'capability_read'
      ? chatReadAuthorizationFor(recovery.command, { hints: remainingHints })
      : undefined;
    appendAppLog('info', 'Jev read recovery decision recorded.', {
      ...requestContext,
      event: 'jev_chat_read_recovery',
      durationMs: Date.now() - recoveryStartedAt,
      previousCapabilityId: failedCapabilityId,
      previousStatus: failedResult.status,
      candidateCount: remainingHints.length,
      outcome: recovery.kind === 'command' ? `${recovery.kind}:${recovery.route}` : recovery.kind,
      ...(recoveryAuthorization ? { selectedCapabilityId: recoveryAuthorization.capabilityId } : {}),
      ...(recovery.telemetry ? {
        jevEvaluationCalls: recovery.telemetry.evaluationCalls,
        jevProviderRequestCount: recovery.telemetry.providerRequestCount,
        jevEstimatedRequestBytes: recovery.telemetry.estimatedRequestBytes,
      } : {}),
    });

    if (recovery.kind === 'request_rejected') {
      options.onRequestRejected?.(recovery.failure);
      return authoritativeRequestClarification(recovery.failure);
    }
    if (recovery.kind === 'parameterized') return missingReadValuesMessage(recovery.plan.requiredParameterPaths);
    if (recovery.kind !== 'command' || recovery.route !== 'capability_read' || !recoveryAuthorization) break;

    const identity = readOperationIdentity(recoveryAuthorization.capabilityId, recoveryAuthorization.params);
    const selectedHint = remainingHints.find((hint) =>
      readOperationIdentity(hint.capabilityId, hint.params) === identity,
    );
    if (!identity || !selectedHint || attempted.has(identity)) break;
    attempted.add(identity);
    const retryResult = await executeScopedChatCommand(context, recovery.command, recoveryAuthorization);
    signal.throwIfAborted();
    current = {
      command: recovery.command,
      result: publishResult(recovery.command.name, retryResult, recovery.command),
      route: recovery,
    };
    failedCapabilityId = recoveryAuthorization.capabilityId;
    appendAppLog('info', 'Jev-selected alternative read completed.', {
      ...requestContext,
      event: 'jev_chat_read_recovery_result',
      capabilityId: recoveryAuthorization.capabilityId,
      status: current.result.status,
    });
    if (current.result.status === 'ok') break;
  }
  return current;
}

export async function commandRoute(turn: JevTurn, route: JevRoute<'command'>): Promise<string> {
  const { context, catalog, requestContext } = turn;
  const { options, signal, publishResult } = context;
  appendAppLog('info', 'Jev selected a bounded chat route.', {
    ...requestContext,
    event: 'jev_chat_route_selected',
    route: route.route,
    command: route.command.name,
    confidence: route.confidence,
    ...(route.tableTransform ? { tableTransform: route.tableTransform } : {}),
    ...(route.tableProjection ? { tableProjection: route.tableProjection } : {}),
    ...(route.readResultStyle ? { readResultStyle: route.readResultStyle } : {}),
    ...(route.command.name === 'capability.invoke' && typeof route.command.args.id === 'string'
      ? { capabilityId: route.command.args.id.slice(0, 256) }
      : {}),
  });
  // Only a read traceable to the catalog (or a user-typed GET path) gets a read authorization.
  const readAuthorization = chatReadAuthorizationFor(route.command, {
    hints: catalog.hints,
    userText: options.requestAnchor?.text ?? options.userMessage,
  });
  const reading = readProgressMessage(route.command);
  if (reading) options.onProgress?.({ message: reading });
  const result = await executeScopedChatCommand(context, route.command, readAuthorization);
  signal.throwIfAborted();
  const resultForLoop = publishResult(route.command.name, result, route.command);
  appendAppLog('info', 'Jev-selected chat route completed.', {
    ...requestContext,
    event: 'jev_chat_route_result',
    route: route.route,
    command: route.command.name,
    status: resultForLoop.status,
  });
  const lifecycleReply = lifecycleCommandReply(route, resultForLoop);
  if (lifecycleReply !== undefined) return lifecycleReply;

  let completed: CompletedRead = { command: route.command, result: resultForLoop, route };
  if (route.route === 'capability_read' && readAuthorization && isRecoverableReadFailure(resultForLoop)) {
    const recovered = await recoverFailedRead(turn, readAuthorization, completed);
    if (typeof recovered === 'string') return recovered;
    completed = recovered;
  }
  // Execution status and host issues are deterministic facts. Do not pay
  // for an LLM paraphrase that could obscure the actual failure.
  if (completed.result.status !== 'ok') {
    return hostFacingMessage(completed.result, '요청을 처리하지 못했습니다.');
  }
  // A filter, ranking or total over a paged API is wrong on its first page alone: gather the rest.
  if (readAuthorization && WHOLE_SET_TRANSFORMS.has(completed.route.tableTransform ?? '')) {
    const startedAt = Date.now();
    const gathered = await readAllHttpPages(completed.command, completed.result, (next) => {
      signal.throwIfAborted();
      // The host moved only the provider's own page parameter; the read stays the authorized one.
      const params = next.name === 'capability.invoke' ? next.args.params as Record<string, unknown> : {};
      return executeScopedChatCommand(context, next, { ...readAuthorization, params });
    });
    signal.throwIfAborted();
    if (gathered.pages > 1) {
      appendAppLog('info', 'Paged read gathered for a whole-set answer.', {
        ...requestContext, event: 'jev_chat_read_pages', pages: gathered.pages, complete: gathered.complete, durationMs: Date.now() - startedAt,
      });
      // The answer's recipe records the whole-set read, so a recurring job made from it reads every page too.
      completed = { ...completed, command: withAllPages(completed.command), result: gathered.result };
    }
  }
  return turn.replies.successfulCommandReply({
    command: completed.command,
    result: completed.result,
    userIntent: options.userMessage,
    phase: 'ax_command_chat_jev_result',
    fallback: '작업은 처리했지만 결과 설명을 생성하지 못했습니다.',
    route: route.route,
    tableTransform: completed.route.tableTransform,
    tableProjection: completed.route.tableProjection,
    readResultStyle: completed.route.readResultStyle,
    llmRequired: route.requestPlan?.response.llmRequired,
  });
}
