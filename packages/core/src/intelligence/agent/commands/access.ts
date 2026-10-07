import type { AxCommandDefinition } from './schema.js';

export interface AxCommandExecutionContext {
  /** Identifies the trusted caller boundary, not a user-selectable mode. */
  origin: 'agent' | 'host';
}

export const AGENT_COMMAND_CONTEXT: AxCommandExecutionContext = {
  origin: 'agent',
};

export const HOST_COMMAND_CONTEXT: AxCommandExecutionContext = {
  origin: 'host',
};

export function commandAccess(
  command: AxCommandDefinition,
  context: AxCommandExecutionContext,
): { allowed: true } | { allowed: false; reason: string } {
  if (context.origin === 'host' && command.lifecycle !== 'read' && command.lifecycle !== 'present') {
    return {
      allowed: false,
      reason: '여기서는 조회와 보기만 할 수 있습니다. 실행이나 저장은 대화창에서 요청해 주세요.',
    };
  }
  return { allowed: true };
}
