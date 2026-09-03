import type { AxCommandIssue, AxInputRequest } from '../schema.js';

export function issue(code: string, message: string, path?: string, inputRequests?: AxInputRequest[]): AxCommandIssue {
  return { code, message, path, ...(inputRequests?.length ? { inputRequests } : {}) };
}

export function sessionInput(): AxInputRequest {
  return {
    id: 'ax-input-discovery-session-id',
    label: 'Discovery 세션',
    type: 'text',
    required: true,
    reason: '확인할 discovery session id를 입력해 주세요.',
  };
}
