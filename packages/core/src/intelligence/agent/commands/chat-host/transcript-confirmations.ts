import type { WorkspaceChatMessage } from '../../../../persistence/repositories/workspace-chat/contracts.js';
import type { AxContextUpdateConfirmation } from '../schema.js';
import { consumeContextConfirmation, findContextConfirmationNonce } from './host-state.js';

export function workflowIdsChanged(result: { command: string; data?: unknown }): {
  changed?: string;
  removed?: string;
} {
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    const workflowId = (result.data as { workflowId?: unknown }).workflowId;
    if (typeof workflowId === 'string' && workflowId.trim()) {
      if (result.command === 'workflow.delete') return { removed: workflowId };
      if (result.command === 'workflow.create' || result.command === 'workflow.update' || result.command === 'job.commit') {
        return { changed: workflowId };
      }
    }
  }
  return {};
}

/**
 * The exact proposal bound to the selected confirm_context action. The proposal comes from
 * the host store keyed by the action's nonce, never from the renderer-saved transcript, and
 * is consumed so one confirmation saves at most once.
 */
export function contextUpdateConfirmation(
  messages: WorkspaceChatMessage[],
  userMessage: string,
  workspaceSessionId: string,
): AxContextUpdateConfirmation | undefined {
  const nonce = findContextConfirmationNonce(messages, userMessage);
  return nonce ? consumeContextConfirmation(workspaceSessionId, nonce) : undefined;
}

/** Non-consuming check used where a confirmation must only be detected and refused. */
export function hasContextConfirmation(messages: WorkspaceChatMessage[], userMessage: string): boolean {
  return Boolean(findContextConfirmationNonce(messages, userMessage));
}

function confirmationTokenFor(
  messages: WorkspaceChatMessage[],
  userMessage: string,
  purpose: 'confirm_job' | 'confirm_mutation',
): string | undefined {
  const actionPrefix = `${purpose}:`;
  // Newest card first: the same confirmation (e.g. "지금 실행") can appear many times in one
  // conversation, and only the latest card's token is still pending.
  for (const message of messages.slice(0, -1).reverse()) {
    if (message.role !== 'assistant') continue;
    for (const presentation of message.presentations ?? []) {
      for (const action of presentation.actions) {
        // Widened so this compiles before every core build exposes `confirm_mutation`.
        const actionPurpose: string = action.purpose;
        if (actionPurpose !== purpose || action.value !== userMessage) continue;
        if (!action.id.startsWith(actionPrefix)) continue;
        const token = action.id.slice(actionPrefix.length).trim();
        if (token) return token;
      }
    }
  }
  return undefined;
}

export function isJobConfirmation(messages: WorkspaceChatMessage[], userMessage: string): string | undefined {
  return confirmationTokenFor(messages, userMessage, 'confirm_job');
}

/** Token of a host-rendered workflow mutation confirmation; core verifies it against its pending store. */
export function mutationConfirmationToken(messages: WorkspaceChatMessage[], userMessage: string): string | undefined {
  return confirmationTokenFor(messages, userMessage, 'confirm_mutation');
}
