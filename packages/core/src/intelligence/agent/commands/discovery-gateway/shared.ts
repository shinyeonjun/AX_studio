import type { AxCommandIssue, AxInputRequest } from '../schema.js';

export function issue(code: string, message: string, path?: string, inputRequests?: AxInputRequest[]): AxCommandIssue {
  return { code, message, path, ...(inputRequests?.length ? { inputRequests } : {}) };
}

export function sessionInput(): AxInputRequest {
  return {
    id: 'ax-input-discovery-session-id',
    label: '업무 찾기',
    type: 'text',
    required: true,
    reason: '확인할 업무 찾기를 골라 주세요.',
  };
}
