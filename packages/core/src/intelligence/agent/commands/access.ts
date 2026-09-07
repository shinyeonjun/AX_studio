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
      reason: '이 호출 경계에서는 조회·표시 command만 허용됩니다. 실행·저장은 agent command 경계를 사용하세요.',
    };
  }
  return { allowed: true };
}
