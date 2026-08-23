import type { InteractionMode } from '../../platform/mode-policy.js';
import type { WorkspaceExecutionMode } from '../../workspace/commands.js';
import type { AxCommandName } from './schema.js';

export interface AxCommandExecutionContext {
  interactionMode: InteractionMode;
  executionMode?: WorkspaceExecutionMode;
}

export const PLAIN_CHAT_COMMAND_CONTEXT: AxCommandExecutionContext = {
  interactionMode: 'plain_chat',
};

const WORKFLOW_MUTATION_COMMANDS = new Set<AxCommandName>([
  'workflow.create',
  'workflow.update',
  'workflow.delete',
]);

export function commandAccess(
  command: AxCommandName,
  context: AxCommandExecutionContext,
): { allowed: true } | { allowed: false; reason: string } {
  if (WORKFLOW_MUTATION_COMMANDS.has(command) && context.interactionMode !== 'authoring') {
    return {
      allowed: false,
      reason: 'workflow 변경은 authoring 대화에서만 허용됩니다.',
    };
  }

  if (command === 'workflow.run' &&
      (context.interactionMode !== 'authoring' || context.executionMode !== 'once')) {
    return {
      allowed: false,
      reason: 'workflow 실행은 명시적인 once 실행 모드에서만 허용됩니다.',
    };
  }

  return { allowed: true };
}
