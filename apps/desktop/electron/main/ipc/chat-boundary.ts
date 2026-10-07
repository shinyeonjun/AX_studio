import {
  ExecutionResultStatusSchema,
  AxInputRequestSchema,
  AxUiPresentationSchema,
  WorkspaceChatApprovalSchema,
  WorkspaceChatGeneratedPdfSchema,
  WorkspaceChatGeneratedSpreadsheetSchema,
  WorkspaceChatReadResultSchema,
  type WorkspaceChatMessage,
} from '@ax-studio/core';

export type DesktopChatMessage = WorkspaceChatMessage;

const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_TRANSCRIPT_MESSAGES = 1_000;
const MAX_CHAT_MESSAGE_CHARS = 50_000;
const MAX_CHAT_INPUT_BYTES = 1_000_000;
const MAX_CHAT_CONTEXT_CHARS = 250_000;

const TRANSCRIPT_SAVE_FAILED = '대화 기록을 저장하지 못했어요. 새로 고친 뒤 다시 시도해 주세요.';
const TRANSCRIPT_TOO_LONG = '대화가 너무 길어 저장하지 못했어요. 새 대화를 시작해 주세요.';

/**
 * A transcript the renderer built wrongly is not something a person can fix field by field:
 * the detail goes to the log (and `detail` for tests), the person gets one thing to do.
 */
function invalidTranscript(detail: string): Error {
  console.warn(`[AX Studio] 대화 기록 검증 실패: ${detail}`);
  return Object.assign(new Error(TRANSCRIPT_SAVE_FAILED), { detail });
}

export function boundedText(value: unknown, field: string, max = MAX_CHAT_MESSAGE_CHARS): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}을(를) 입력해 주세요.`);
  }
  if (value.length > max) {
    throw new Error(`${field}이(가) 너무 길어요. ${max.toLocaleString()}자 이내로 입력해 주세요.`);
  }
  return value;
}

/** Validate untrusted renderer input before it reaches a provider or database. */
export function normalizeChatMessages(value: unknown): DesktopChatMessage[] {
  if (!Array.isArray(value)) throw invalidTranscript('대화 기록이 배열이 아닙니다.');
  if (value.length > MAX_CHAT_TRANSCRIPT_MESSAGES) {
    throw new Error(`대화 기록은 ${MAX_CHAT_TRANSCRIPT_MESSAGES.toLocaleString()}개 메시지까지 저장할 수 있어요. 새 대화를 시작해 주세요.`);
  }
  let totalBytes = 0;
  const messages = value.map<DesktopChatMessage>((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidTranscript(`대화 ${index + 1}번째 메시지 형식이 올바르지 않습니다.`);
    }
    const record = entry as Record<string, unknown>;
    if (record.turnId !== undefined && (typeof record.turnId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(record.turnId))) {
      throw new Error('workspace_chat_invalid_turn_id');
    }
    if (record.role !== 'user' && record.role !== 'assistant') {
      throw invalidTranscript(`대화 ${index + 1}번째 메시지 역할이 올바르지 않습니다.`);
    }
    if (typeof record.content !== 'string') {
      throw invalidTranscript(`대화 ${index + 1}번째 메시지 내용이 올바르지 않습니다.`);
    }
    if (record.content.length > MAX_CHAT_MESSAGE_CHARS) {
      throw new Error(`메시지가 너무 길어 저장하지 못했어요. ${MAX_CHAT_MESSAGE_CHARS.toLocaleString()}자 이내로 줄여 주세요.`);
    }
    totalBytes += Buffer.byteLength(record.content, 'utf8');
    if (totalBytes > MAX_CHAT_INPUT_BYTES) {
      throw new Error(TRANSCRIPT_TOO_LONG);
    }
    if (record.kind !== undefined && record.kind !== 'execution_result') {
      throw invalidTranscript(`대화 ${index + 1}번째 메시지 종류가 올바르지 않습니다.`);
    }
    if (record.executionId !== undefined &&
      (typeof record.executionId !== 'string' || record.executionId.length === 0 || record.executionId.length > 128)) {
      throw invalidTranscript(`대화 ${index + 1}번째 실행 id가 올바르지 않습니다.`);
    }
    if (record.kind === 'execution_result' && typeof record.executionId !== 'string') {
      throw invalidTranscript(`대화 ${index + 1}번째 실행 결과에 실행 id가 필요합니다.`);
    }
    if (record.executionStatus !== undefined && record.kind !== 'execution_result') {
      throw invalidTranscript(`대화 ${index + 1}번째 실행 상태는 실행 결과 메시지에만 사용할 수 있습니다.`);
    }
    if (record.inputContinuation !== undefined && record.inputContinuation !== 'command') {
      throw invalidTranscript(`대화 ${index + 1}번째 입력 이어가기 형식이 올바르지 않습니다.`);
    }
    const executionStatus = record.executionStatus === undefined
      ? undefined
      : ExecutionResultStatusSchema.safeParse(record.executionStatus);
    if (executionStatus && !executionStatus.success) {
      throw invalidTranscript(`대화 ${index + 1}번째 실행 결과 상태가 올바르지 않습니다.`);
    }
    const inputRequests = record.inputRequests === undefined
      ? undefined
      : AxInputRequestSchema.array().max(8).safeParse(record.inputRequests);
    if (inputRequests && !inputRequests.success) {
      throw invalidTranscript(`대화 ${index + 1}번째 메시지 입력 요청 형식이 올바르지 않습니다.`);
    }
    const presentations = record.presentations === undefined
      ? undefined
      : AxUiPresentationSchema.array().max(4).safeParse(record.presentations);
    if (presentations && !presentations.success) {
      throw invalidTranscript(`대화 ${index + 1}번째 메시지 UI 형식이 올바르지 않습니다.`);
    }
    const approval = record.approval === undefined
      ? undefined
      : WorkspaceChatApprovalSchema.safeParse(record.approval);
    if (approval && !approval.success) {
      throw invalidTranscript(`대화 ${index + 1}번째 승인 정보 형식이 올바르지 않습니다.`);
    }
    if (approval?.success && record.kind !== 'execution_result') {
      throw invalidTranscript(`대화 ${index + 1}번째 승인 정보는 실행 결과 메시지에만 사용할 수 있습니다.`);
    }
    const generatedPdf = record.generatedPdf === undefined
      ? undefined
      : WorkspaceChatGeneratedPdfSchema.safeParse(record.generatedPdf);
    if (generatedPdf && !generatedPdf.success) {
      throw invalidTranscript(`대화 ${index + 1}번째 생성 PDF 정보 형식이 올바르지 않습니다.`);
    }
    if (generatedPdf?.success && record.kind !== 'execution_result') {
      throw invalidTranscript(`대화 ${index + 1}번째 생성 PDF 정보는 실행 결과 메시지에만 사용할 수 있습니다.`);
    }
    const generatedSpreadsheet = record.generatedSpreadsheet === undefined ? undefined
      : WorkspaceChatGeneratedSpreadsheetSchema.safeParse(record.generatedSpreadsheet);
    if (generatedSpreadsheet && (!generatedSpreadsheet.success || record.kind !== 'execution_result')) {
      throw invalidTranscript(`대화 ${index + 1}번째 Excel 산출물 정보가 올바르지 않습니다.`);
    }
    const readResult = record.readResult === undefined
      ? undefined
      : WorkspaceChatReadResultSchema.safeParse(record.readResult);
    if (readResult && !readResult.success) {
      throw invalidTranscript(`대화 ${index + 1}번째 이전 표 결과 형식이 올바르지 않거나 너무 큽니다.`);
    }
    if (readResult?.success && record.role !== 'assistant') {
      throw invalidTranscript(`대화 ${index + 1}번째 이전 표 결과는 assistant 메시지에만 사용할 수 있습니다.`);
    }
    if (readResult?.success) {
      totalBytes += Buffer.byteLength(JSON.stringify(readResult.data), 'utf8');
      if (totalBytes > MAX_CHAT_INPUT_BYTES) {
        throw new Error(TRANSCRIPT_TOO_LONG);
      }
    }
    return {
      role: record.role,
      content: record.content,
      ...(typeof record.turnId === 'string' ? { turnId: record.turnId } : {}),
      ...(record.registeredMetadataTurn === true ? { registeredMetadataTurn: true as const } : {}),
      ...(record.kind === 'execution_result' ? { kind: record.kind } : {}),
      ...(typeof record.executionId === 'string' ? { executionId: record.executionId } : {}),
      ...(executionStatus ? { executionStatus: executionStatus.data } : {}),
      ...(record.inputContinuation === 'command' ? { inputContinuation: record.inputContinuation } : {}),
      ...(inputRequests ? { inputRequests: inputRequests.data } : {}),
      ...(presentations ? { presentations: presentations.data } : {}),
      ...(approval ? { approval: approval.data } : {}),
      ...(generatedPdf ? { generatedPdf: generatedPdf.data } : {}),
      ...(generatedSpreadsheet?.success ? { generatedSpreadsheet: generatedSpreadsheet.data } : {}),
      ...(readResult ? { readResult: readResult.data } : {}),
      // Only shows the "반복 업무로" offer; the job is still built from the recipe the host kept.
      ...(readResult && record.readRepeatable === true ? { readRepeatable: true as const } : {}),
    };
  });
  return messages;
}

/** Persist the bounded transcript; send a smaller recent context to a model. */
export function selectChatContext(messages: DesktopChatMessage[]): DesktopChatMessage[] {
  const notice: DesktopChatMessage = {
    role: 'user',
    content: '[호스트 대화 안내] 오래된 대화 일부는 모델 입력 한도로 생략되었습니다. 전체 기록은 대화에 보존되어 있습니다. 현재 업무·자료·메모와 최근 지시를 기준으로 처리하고, 생략된 기준이 필요하면 추측하지 말고 사용자에게 확인하세요.',
  };
  let chars = notice.content.length;
  let start = messages.length;
  while (start > 0 && messages.length - start < MAX_CHAT_MESSAGES - 1) {
    const next = messages[start - 1]!;
    if (chars + next.content.length > MAX_CHAT_CONTEXT_CHARS) break;
    chars += next.content.length;
    start -= 1;
  }
  return start === 0 ? messages : [notice, ...messages.slice(start)];
}

/** Select the request that was persisted before any later background result. */
export function selectMessagesThroughUserMessage(
  messages: DesktopChatMessage[],
  userMessage: string,
): DesktopChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && message.content === userMessage) {
      return messages.slice(0, index + 1);
    }
  }
  throw new Error('현재 사용자 메시지를 찾을 수 없어요. 새로 고친 뒤 다시 보내 주세요.');
}

/** Metadata requires an exact persisted turn identity, including its original text. */
export function selectMessagesThroughUserTurn(messages: DesktopChatMessage[], userMessage: string, turnId: unknown): DesktopChatMessage[] {
  if (typeof turnId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(turnId)) throw new Error('workspace_chat_invalid_turn_id');
  const matches = messages.flatMap((message, index) => message.role === 'user' && message.turnId === turnId ? [index] : []);
  if (matches.length !== 1 || messages[matches[0]!]!.content !== userMessage) throw new Error('workspace_chat_turn_conflict');
  return messages.slice(0, matches[0]! + 1);
}

export function commandInputContinuation(
  messages: DesktopChatMessage[],
): {
  request: string;
  requestIds: string[];
  values: { requestId: string; value: string }[];
} | undefined {
  const currentIndex = messages.length - 1;
  const current = messages[currentIndex];
  const prompt = messages[currentIndex - 1];
  if (current?.role !== 'user' || prompt?.role !== 'assistant'
    || prompt.inputContinuation !== 'command') return undefined;

  const requestsFor = (message: DesktopChatMessage) => [...new Map([
    ...(message.inputRequests ?? []),
    ...(message.presentations ?? []).flatMap((presentation) => presentation.inputs),
  ].map((request) => [request.id, request])).values()];
  const promptRequests = requestsFor(prompt);
  if (promptRequests.length === 0) return undefined;
  const submittedValues = (
    content: string,
    requests: NonNullable<DesktopChatMessage['inputRequests']>,
  ): { requestId: string; value: string }[] | undefined => {
    const lines = content.split(/\r?\n/u);
    const values: { requestId: string; value: string }[] = [];
    for (const request of requests) {
      const matchingLines = lines.filter((line) => line.startsWith(`${request.label}:`));
      if (matchingLines.length === 0) continue;
      if (matchingLines.length !== 1) return undefined;
      const line = matchingLines[0]!;
      if (request.options?.length) {
        const option = request.options.find((entry) =>
          line === `${request.label}: ${entry.label} (ID: ${entry.value})`);
        if (!option) return undefined;
        values.push({ requestId: request.id, value: option.value });
        continue;
      }
      const value = line.slice(request.label.length + 1).trim();
      if (value) values.push({ requestId: request.id, value: value.slice(0, 2_000) });
    }
    return values;
  };

  const currentValues = submittedValues(current.content, promptRequests);
  if (!currentValues?.length) return undefined;
  let request: string | undefined;
  for (let index = currentIndex - 2; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== 'user') continue;
    const previousPrompt = messages[index - 1];
    if (previousPrompt?.role === 'assistant' && previousPrompt.inputContinuation === 'command') continue;
    request = message.content;
    break;
  }
  if (!request) return undefined;
  return {
    request,
    requestIds: [...new Set(promptRequests.map((entry) => entry.id))].sort(),
    values: currentValues,
  };
}
