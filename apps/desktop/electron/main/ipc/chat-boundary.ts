import {
  ExecutionResultStatusSchema,
  AxInputRequestSchema,
  AxUiPresentationSchema,
  WorkspaceChatApprovalSchema,
  WorkspaceChatGeneratedPdfSchema,
  type WorkspaceChatMessage,
} from '@ax-studio/core';

export type DesktopChatMessage = WorkspaceChatMessage;

const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_MESSAGE_CHARS = 50_000;
const MAX_CHAT_TOTAL_CHARS = 250_000;

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
  if (value.length > MAX_CHAT_MESSAGES) {
    throw new Error(`대화 기록은 ${MAX_CHAT_MESSAGES}개 메시지까지 보낼 수 있습니다.`);
  }

  let totalChars = 0;
  return value.map((entry, index) => {
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
    const executionStatus = record.executionStatus === undefined
      ? undefined
      : ExecutionResultStatusSchema.safeParse(record.executionStatus);
    if (executionStatus && !executionStatus.success) {
      throw new Error(`대화 ${index + 1}번째 실행 결과 상태가 올바르지 않습니다.`);
    }
    totalChars += record.content.length;
    if (totalChars > MAX_CHAT_TOTAL_CHARS) {
      throw new Error(`대화 기록이 너무 큽니다. ${MAX_CHAT_TOTAL_CHARS.toLocaleString()}자 이내로 줄여 주세요.`);
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
    return {
      role: record.role,
      content: record.content,
      ...(record.kind === 'execution_result' ? { kind: record.kind } : {}),
      ...(typeof record.executionId === 'string' ? { executionId: record.executionId } : {}),
      ...(executionStatus ? { executionStatus: executionStatus.data } : {}),
      ...(inputRequests ? { inputRequests: inputRequests.data } : {}),
      ...(presentations ? { presentations: presentations.data } : {}),
      ...(approval ? { approval: approval.data } : {}),
      ...(generatedPdf ? { generatedPdf: generatedPdf.data } : {}),
    };
  });
}

export function requireLastUserMessage(messages: DesktopChatMessage[]): string {
  const last = messages.at(-1);
  if (!last || last.role !== 'user' || !last.content.trim()) {
    throw new Error('사용자 메시지가 필요합니다.');
  }
  return last.content.trim();
}
