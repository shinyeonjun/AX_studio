import type { DesignToolId } from '../design-tools/types.js';
import type { WorkspaceCommand } from '../workspace/commands.js';

export type InteractionMode = 'plain_chat' | 'authoring';

export function interactionModeFromCommand(command: WorkspaceCommand): InteractionMode {
  return command.mode === 'chat' ? 'plain_chat' : 'authoring';
}

const PLAIN_CHAT_TOOLS = new Set<DesignToolId>([
  'tools.list',
  'connections.list',
  'sources.list',
  'sources.files.list',
  'sources.file.read',
  'sources.search',
  'capabilities.list',
  'capabilities.describe',
  'capabilities.invoke',
  'workflows.list',
  'workflows.run',
]);

const AUTHORING_ONLY_TOOLS = new Set<DesignToolId>(['workflow.inspect']);

const PLAIN_CHAT_ONLY_TOOLS = new Set<DesignToolId>(['workflows.list', 'workflows.run']);

export function isToolAllowedInMode(tool: DesignToolId, mode: InteractionMode): boolean {
  if (mode === 'plain_chat') {
    if (AUTHORING_ONLY_TOOLS.has(tool)) return false;
    return PLAIN_CHAT_TOOLS.has(tool);
  }
  if (PLAIN_CHAT_ONLY_TOOLS.has(tool)) return false;
  return true;
}

export function filterToolCallsForMode<T extends { tool: DesignToolId }>(
  calls: T[],
  mode: InteractionMode,
): T[] {
  return calls.filter((call) => isToolAllowedInMode(call.tool, mode));
}

export function assertPlainChatCannotAuthor(command: WorkspaceCommand): void {
  if (command.mode !== 'chat') return;
  // Authoring is slash-only; callers route /once and /workflow before workspace chat.
}
