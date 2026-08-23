import { DESIGN_TOOL_IDS, type DesignToolId } from '../design-tools/types.js';
import type { WorkspaceCommand } from '../workspace/commands.js';

export type InteractionMode = 'plain_chat' | 'authoring';

export function interactionModeFromCommand(command: WorkspaceCommand): InteractionMode {
  return command.mode === 'chat' ? 'plain_chat' : 'authoring';
}

const DESIGN_TOOLS = new Set<DesignToolId>(DESIGN_TOOL_IDS);

export function isToolAllowedInMode(tool: DesignToolId, mode: InteractionMode): boolean {
  return DESIGN_TOOLS.has(tool);
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
