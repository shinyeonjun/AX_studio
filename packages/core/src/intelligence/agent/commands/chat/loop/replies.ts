import { getCapability } from '../../../../../catalog/data.js';
import type { TransformExpr } from '../../../../../workflow/transform-expr/dsl.js';
import { shapingBackground, withDecisionBackground } from '../shaping/decision-background.js';
import { chatReadRecipe } from '../result/read-recipe.js';
import { resolveAuthoritativeRequestAnchor, guardAuthoritativeRequestDecisions } from '../../../../decision/request-anchor.js';
import type { ChatMessage } from '../../../model/chat.js';
import type { TableArtifact } from '../../../../../contracts/artifacts/table.js';
import { labeledTable, type ColumnLabels } from '../../../../../contracts/artifacts/column-labels.js';
import { columnLabelsFor } from '../shaping/column-labeler.js';
import { AxCapabilityInvokeArgsSchema, type AxCommand, type AxCommandResult } from '../../schema.js';
import {
  CurrentUserRequestTooLargeError,
  compactModelMessages,
  chatReplyPrompt,
  resultMessage,
} from './protocol.js';
import {
  deterministicHttpChatReply,
  deterministicHttpConnectionListChatReply,
  deterministicCapabilityReadChatReply,
  deterministicMetadataChatReply,
  deterministicWorkflowListChatReply,
  boundedChatReadResult,
  compactSummaryTable,
  formatTableArtifact,
  hostFacingMessage,
  selectedColumnsFromHttpPath,
  tableForJevTransform,
} from '../result/index.js';
import { applyJevTableTransform, type JevTableTransformRequest } from '../shaping/table-transform/index.js';
import { appendAppLog } from '../../../../../persistence/paths/app-log.js';
import { chatRequestContext, type CommandChatLoopContext } from './turn-context.js';

interface SuccessfulCommandReplyInput {
  command: AxCommand;
  result: AxCommandResult;
  userIntent: string;
  phase: string;
  fallback: string;
  route?: string;
  tableTransform?: JevTableTransformRequest;
  tableProjection?: 'requested_columns';
  readResultStyle?: 'summary';
  llmRequired?: boolean;
}

export interface ChatReplies {
  textReplyFromModel: (
    phase: string,
    systemPrompt?: string,
    replyMessages?: ChatMessage[],
    requiredUserMessage?: string,
  ) => Promise<string | undefined>;
  successfulCommandReply: (input: SuccessfulCommandReplyInput) => Promise<string>;
}

type TransformOutcome = { reply: string } | { table: TableArtifact; expression: TransformExpr } | { confirmedNoTransform: true } | undefined;

/** Reply builders shared by every chat route: model text, Jev table shaping, and deterministic renderers. */
export function createChatReplies(context: CommandChatLoopContext): ChatReplies {
  const { options, messages, signal } = context;
  const requestContext = chatRequestContext(options);

  const textReplyFromModel: ChatReplies['textReplyFromModel'] = async (
    phase,
    systemPrompt,
    replyMessages = messages,
    requiredUserMessage = options.userMessage,
  ) => {
    try {
      const reply = await options.harness.runText({
        requestId: options.requestId,
        role: 'command',
        systemPrompt: systemPrompt ?? chatReplyPrompt(options),
        messages: compactModelMessages(replyMessages, requiredUserMessage),
        sessionId: options.providerSessionId,
        onProgress: options.onProgress,
        logContext: phase,
        abortSignal: signal,
      });
      const output = reply.output.trim();
      if (!output) return undefined;
      appendAppLog('info', 'Chat received a text-only reply.', {
        ...requestContext,
        event: 'chat_reply_generated',
        phase,
        provider: reply.provider,
        durationMs: reply.durationMs,
        promptChars: reply.promptChars,
        providerUsageAvailable: Boolean(reply.usage),
        ...(reply.usage ? { usage: reply.usage } : {}),
      });
      return output;
    } catch (error) {
      signal.throwIfAborted();
      appendAppLog('warn', 'Chat text reply could not be generated; no command-model fallback will run.', {
        ...requestContext,
        event: 'chat_text_reply_failed',
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof CurrentUserRequestTooLargeError) {
        return '현재 요청이 너무 길어 내용을 온전히 답변에 반영할 수 없습니다. 요청을 나눠 보내거나 긴 자료를 파일로 첨부해 주세요.';
      }
      return undefined;
    }
  };

  const jevTransformReply = async (
    command: AxCommand,
    result: AxCommandResult,
    userMessage: string,
    request?: JevTableTransformRequest,
    projection?: 'requested_columns',
    labels: ColumnLabels = {},
  ): Promise<TransformOutcome> => {
    if (request === 'none' && !projection) return { confirmedNoTransform: true };
    if (!options.decisionEngine) return undefined;
    if (request === 'uncertain') {
      return { reply: '필터·정렬 요청을 하나의 안전한 표 변환으로 판단하지 못했습니다. 기준과 순서를 조금 더 구체적으로 알려 주세요.' };
    }
    const read = tableForJevTransform(command, result);
    // Shaped under its Korean headers, so Jev's choices and the result's name read as people do.
    const table = read ? labeledTable(read, labels) : undefined;
    if (!table) {
      const tableActions = [
        ...(projection ? ['요청한 열 선택'] : []),
        ...(request && request !== 'none' && request !== 'auto' ? ['필터·정렬'] : []),
      ];
      return tableActions.length > 0
        ? { reply: `조회 결과가 표 형태가 아니어서 ${tableActions.join(' 및 ')}을 적용할 수 없습니다. 결과 형식이나 요청을 확인해 주세요.` }
        : undefined;
    }

    const startedAt = Date.now();
    const plan = await applyJevTableTransform({
      // What the person confirmed (their definitions of VIP, 매출 …) informs which rows and totals.
      decisionEngine: guardAuthoritativeRequestDecisions(withDecisionBackground(options.decisionEngine, shapingBackground({ sessionMemo: context.options.sessionMemo, workflowPolicy: context.session.workflowPolicy })),
        resolveAuthoritativeRequestAnchor(userMessage,
          options.requestAnchor?.text === userMessage ? options.requestAnchor : undefined,
          {}, options.requestBudget), options.requestBudget),
      table,
      userMessage,
      mode: request ?? 'auto',
      selectRequestedColumns: projection === 'requested_columns',
      httpSelectedColumns: command.name === 'capability.invoke' && command.args.id === 'http.request'
        ? selectedColumnsFromHttpPath(command.args.params)
        : undefined,
      abortSignal: signal,
    });
    if (plan.status === 'not_applicable') return { confirmedNoTransform: true };
    appendAppLog('info', 'Jev table transform decision recorded.', {
      ...requestContext,
      event: 'jev_chat_table_transform',
      durationMs: Date.now() - startedAt,
      status: plan.status,
      ...('providerRequestCount' in plan && plan.providerRequestCount !== undefined
        ? { providerRequestCount: plan.providerRequestCount } : {}),
      ...('model' in plan && plan.model ? { model: plan.model } : {}),
      ...(!('usage' in plan) || plan.usage?.inputTokens === undefined ? {} : { inputTokens: plan.usage.inputTokens }),
      ...(!('usage' in plan) || plan.usage?.outputTokens === undefined ? {} : { outputTokens: plan.usage.outputTokens }),
      ...(plan.status === 'transformed' ? { rowCount: plan.table.rows.length } : {}),
    });
    if (plan.status === 'transformed') return { table: plan.table, expression: plan.expression };
    if (plan.status === 'export_xlsx') return { reply: '조회한 표를 확인한 뒤 이 표를 Excel로 저장해 달라고 요청해 주세요. 아직 파일은 만들지 않았습니다.' };
    if (plan.status === 'clarify') return { reply: plan.message };
    const unavailableWork = [
      ...(request && request !== 'none' && request !== 'auto' ? ['필터·정렬'] : []),
      ...(projection ? ['요청한 열 선택'] : []),
    ].join(' 및 ') || '요청한 결과 변환';
    return { reply: `조회는 완료했지만 판단 엔진(Jev)이 응답하지 않아 ${unavailableWork}을 적용하지 않았습니다. 잠시 뒤 다시 요청해 주세요. 계속되면 설정 > 판단 엔진에서 상태를 확인해 주세요.` };
  };

  const summaryReply = async (
    command: AxCommand,
    result: AxCommandResult,
    userIntent: string,
    transformOutcome: TransformOutcome,
  ): Promise<string> => {
    const summaryTable = transformOutcome && 'table' in transformOutcome
      ? transformOutcome.table
      : tableForJevTransform(command, result);
    if (!summaryTable && transformOutcome && 'reply' in transformOutcome) {
      return transformOutcome.reply;
    }
    const compacted = summaryTable ? compactSummaryTable(summaryTable) : undefined;
    const summaryResult = compacted
      && result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? { ...result, data: { ...result.data, data: compacted } }
      : result;
    const commandMessage: ChatMessage = {
      role: 'assistant', content: JSON.stringify({ kind: 'command', command }),
    };
    const evidenceMessage: ChatMessage = { role: 'user', content: resultMessage(summaryResult) };
    messages.push(commandMessage, evidenceMessage);
    const reply = await textReplyFromModel(
      'ax_command_chat_jev_summary',
      undefined,
      [{ role: 'user', content: userIntent }, commandMessage, evidenceMessage],
      userIntent,
    );
    return reply ?? hostFacingMessage(result, '조회는 완료했지만 요약을 생성하지 못했습니다.');
  };

  const successfulCommandReply = async ({
    command,
    result,
    userIntent,
    phase,
    fallback,
    route,
    tableTransform,
    tableProjection,
    readResultStyle,
    llmRequired,
  }: SuccessfulCommandReplyInput): Promise<string> => {
    const invokeArgs = command.name === 'capability.invoke'
      ? AxCapabilityInvokeArgsSchema.safeParse(command.args)
      : undefined;
    const explicitHttpRead = invokeArgs?.success === true && invokeArgs.data.id === 'http.request'
      && ['GET', 'HEAD'].includes(String(invokeArgs.data.params.method ?? 'GET').toUpperCase());
    const showsReadTable = route === 'capability_read' || route === 'http_read' || explicitHttpRead;
    // The read table is shown (and shaped): its columns get Korean headers people can read first.
    const readTable = showsReadTable ? tableForJevTransform(command, result) : undefined;
    // Columns the source names itself are labelled from its catalog; only the rest are asked about.
    const sourceCapability = command.name === 'capability.invoke' && typeof command.args.id === 'string'
      ? getCapability(command.args.id)
      : undefined;
    const sourceLabels = sourceCapability?.outputColumnLabels ?? {};
    const labels: ColumnLabels = readTable
      ? { ...await columnLabelsFor(labeledTable(readTable, sourceLabels), { memory: options.columnLabels, harness: options.harness, requestId: options.requestId, signal }), ...sourceLabels }
      : {};
    const transformOutcome = await jevTransformReply(command, result, userIntent, tableTransform, tableProjection, labels);
    if (showsReadTable) {
      const shown = transformOutcome && 'table' in transformOutcome ? transformOutcome.table : readTable;
      const table = shown ? labeledTable(shown, labels) : undefined;
      options.onReadResult?.(table ? boundedChatReadResult(table) : undefined);
      options.onReadRecipe?.(table
        ? chatReadRecipe(command, result, transformOutcome && 'expression' in transformOutcome ? transformOutcome.expression : undefined)
        : undefined);
    }
    if (readResultStyle === 'summary') return summaryReply(command, result, userIntent, transformOutcome);
    if (transformOutcome && 'reply' in transformOutcome) return transformOutcome.reply;
    if (transformOutcome && 'table' in transformOutcome) {
      return formatTableArtifact(labeledTable(transformOutcome.table, labels), sourceCapability?.hiddenColumns);
    }

    const jevConfirmedNoTransform = tableTransform === 'none' || transformOutcome?.confirmedNoTransform === true;
    const deterministicReply = deterministicHttpChatReply(command, result, userIntent, jevConfirmedNoTransform, labels)
      ?? deterministicHttpConnectionListChatReply(command, result, userIntent)
      ?? deterministicCapabilityReadChatReply(command, result, userIntent, jevConfirmedNoTransform, labels)
      ?? deterministicMetadataChatReply(command, result, userIntent)
      ?? deterministicWorkflowListChatReply(command, result, userIntent);
    if (deterministicReply) {
      if (route) {
        appendAppLog('info', 'Jev-selected read used a deterministic chat renderer.', {
          ...requestContext,
          event: 'jev_chat_deterministic_reply',
          route,
          command: command.name,
        });
      }
      return deterministicReply;
    }

    // No written answer was wanted, so none was attempted: a success is reported as one.
    if (llmRequired === false) {
      return hostFacingMessage(result, result.status === 'ok' ? '요청한 작업을 처리했습니다.' : fallback);
    }

    messages.push(
      { role: 'assistant', content: JSON.stringify({ kind: 'command', command }) },
      { role: 'user', content: resultMessage(result) },
    );
    const reply = await textReplyFromModel(phase);
    return reply ?? hostFacingMessage(result, fallback);
  };

  return { textReplyFromModel, successfulCommandReply };
}
