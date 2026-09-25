import {
  ExecutionResultStatusSchema,
  AxInputRequestSchema,
  AxUiPresentationSchema,
  WorkspaceChatApprovalSchema,
  WorkspaceChatGeneratedPdfSchema,
  WorkspaceChatReadResultSchema,
  type WorkspaceChatMessage,
} from '@ax-studio/core';

export type DesktopChatMessage = WorkspaceChatMessage;

const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_TRANSCRIPT_MESSAGES = 1_000;
const MAX_CHAT_MESSAGE_CHARS = 50_000;
const MAX_CHAT_INPUT_BYTES = 1_000_000;
const MAX_CHAT_CONTEXT_CHARS = 250_000;

export function boundedText(value: unknown, field: string, max = MAX_CHAT_MESSAGE_CHARS): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field}을(를) 입력해 주세요.`);
  }
  if (value.length > max) {
    throw new Error(`${field}이(가) 너무 깁니다. ${max.toLocaleString()}자 이내로 입력해 주세요.`);
  }
  return value;
}

/** Validate untrusted renderer input before it reaches a provider or database. */
export function normalizeChatMessages(value: unknown): DesktopChatMessage[] {
  if (!Array.isArray(value)) throw new Error('대화 기록 형식이 올바르지 않습니다.');
  if (value.length > MAX_CHAT_TRANSCRIPT_MESSAGES) {
    throw new Error(`대화 기록은 ${MAX_CHAT_TRANSCRIPT_MESSAGES.toLocaleString()}개 메시지까지 저장할 수 있습니다.`);
  }
  let totalBytes = 0;
  const messages = value.map<DesktopChatMessage>((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`대화 ${index + 1}번째 메시지 형식이 올바르지 않습니다.`);
    }
    const record = entry as Record<string, unknown>;
    if (record.role !== 'user' && record.role !== 'assistant') {
      throw new Error(`대화 ${index + 1}번째 메시지 역할이 올바르지 않습니다.`);
    }
    if (typeof record.content !== 'string') {
      throw new Error(`대화 ${index + 1}번째 메시지 내용이 올바르지 않습니다.`);
    }
    if (record.content.length > MAX_CHAT_MESSAGE_CHARS) {
      throw new Error(`대화 ${index + 1}번째 메시지가 너무 깁니다.`);
    }
    totalBytes += Buffer.byteLength(record.content, 'utf8');
    if (totalBytes > MAX_CHAT_INPUT_BYTES) {
      throw new Error(`대화 기록은 ${MAX_CHAT_INPUT_BYTES.toLocaleString()}바이트까지 저장할 수 있습니다.`);
    }
    if (record.kind !== undefined && record.kind !== 'execution_result') {
      throw new Error(`대화 ${index + 1}번째 메시지 종류가 올바르지 않습니다.`);
    }
    if (record.executionId !== undefined &&
      (typeof record.executionId !== 'string' || record.executionId.length === 0 || record.executionId.length > 128)) {
      throw new Error(`대화 ${index + 1}번째 실행 id가 올바르지 않습니다.`);
    }
    if (record.kind === 'execution_result' && typeof record.executionId !== 'string') {
      throw new Error(`대화 ${index + 1}번째 실행 결과에 실행 id가 필요합니다.`);
    }
    if (record.executionStatus !== undefined && record.kind !== 'execution_result') {
      throw new Error(`대화 ${index + 1}번째 실행 상태는 실행 결과 메시지에만 사용할 수 있습니다.`);
    }
    if (record.inputContinuation !== undefined && record.inputContinuation !== 'command') {
      throw new Error(`대화 ${index + 1}번째 입력 이어가기 형식이 올바르지 않습니다.`);
    }
    const executionStatus = record.executionStatus === undefined
      ? undefined
      : ExecutionResultStatusSchema.safeParse(record.executionStatus);
    if (executionStatus && !executionStatus.success) {
      throw new Error(`대화 ${index + 1}번째 실행 결과 상태가 올바르지 않습니다.`);
    }
    const inputRequests = record.inputRequests === undefined
      ? undefined
      : AxInputRequestSchema.array().max(8).safeParse(record.inputRequests);
    if (inputRequests && !inputRequests.success) {
      throw new Error(`대화 ${index + 1}번째 메시지 입력 요청 형식이 올바르지 않습니다.`);
    }
    const presentations = record.presentations === undefined
      ? undefined
      : AxUiPresentationSchema.array().max(4).safeParse(record.presentations);
    if (presentations && !presentations.success) {
      throw new Error(`대화 ${index + 1}번째 메시지 UI 형식이 올바르지 않습니다.`);
    }
    const approval = record.approval === undefined
      ? undefined
      : WorkspaceChatApprovalSchema.safeParse(record.approval);
    if (approval && !approval.success) {
      throw new Error(`대화 ${index + 1}번째 승인 정보 형식이 올바르지 않습니다.`);
    }
    if (approval?.success && record.kind !== 'execution_result') {
      throw new Error(`대화 ${index + 1}번째 승인 정보는 실행 결과 메시지에만 사용할 수 있습니다.`);
    }
    const generatedPdf = record.generatedPdf === undefined
      ? undefined
      : WorkspaceChatGeneratedPdfSchema.safeParse(record.generatedPdf);
    if (generatedPdf && !generatedPdf.success) {
      throw new Error(`대화 ${index + 1}번째 생성 PDF 정보 형식이 올바르지 않습니다.`);
    }
    if (generatedPdf?.success && record.kind !== 'execution_result') {
      throw new Error(`대화 ${index + 1}번째 생성 PDF 정보는 실행 결과 메시지에만 사용할 수 있습니다.`);
    }
    const readResult = record.readResult === undefined
      ? undefined
      : WorkspaceChatReadResultSchema.safeParse(record.readResult);
    if (readResult && !readResult.success) {
      throw new Error(`대화 ${index + 1}번째 이전 표 결과 형식이 올바르지 않거나 너무 큽니다.`);
    }
    if (readResult?.success && record.role !== 'assistant') {
      throw new Error(`대화 ${index + 1}번째 이전 표 결과는 assistant 메시지에만 사용할 수 있습니다.`);
    }
    if (readResult?.success) {
      totalBytes += Buffer.byteLength(JSON.stringify(readResult.data), 'utf8');
      if (totalBytes > MAX_CHAT_INPUT_BYTES) {
        throw new Error(`대화 기록은 ${MAX_CHAT_INPUT_BYTES.toLocaleString()}바이트까지 저장할 수 있습니다.`);
      }
    }
    return {
      role: record.role,
      content: record.content,
      ...(record.kind === 'execution_result' ? { kind: record.kind } : {}),
      ...(typeof record.executionId === 'string' ? { executionId: record.executionId } : {}),
      ...(executionStatus ? { executionStatus: executionStatus.data } : {}),
      ...(record.inputContinuation === 'command' ? { inputContinuation: record.inputContinuation } : {}),
      ...(inputRequests ? { inputRequests: inputRequests.data } : {}),
      ...(presentations ? { presentations: presentations.data } : {}),
      ...(approval ? { approval: approval.data } : {}),
      ...(generatedPdf ? { generatedPdf: generatedPdf.data } : {}),
      ...(readResult ? { readResult: readResult.data } : {}),
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
  throw new Error('현재 사용자 메시지를 찾을 수 없습니다.');
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
