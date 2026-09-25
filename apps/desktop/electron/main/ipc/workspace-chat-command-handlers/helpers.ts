import type { AxContextUpdateConfirmation, WorkspaceChatMessage } from '@ax-studio/core';

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

export function contextUpdateConfirmation(
  messages: WorkspaceChatMessage[],
  userMessage: string,
): AxContextUpdateConfirmation | undefined {
  for (const message of messages.slice(0, -1).reverse()) {
    if (message.role !== 'assistant') continue;
    for (const presentation of [...(message.presentations ?? [])].reverse()) {
      for (const action of [...presentation.actions].reverse()) {
        if (action.purpose === 'confirm_context' && action.value === userMessage && action.contextUpdate) {
          return action.contextUpdate;
        }
      }
    }
  }
  return undefined;
}

export function isJobConfirmation(messages: WorkspaceChatMessage[], userMessage: string): string | undefined {
  const actionPrefix = 'confirm_job:';
  for (const message of messages.slice(0, -1)) {
    if (message.role !== 'assistant') continue;
    for (const presentation of message.presentations ?? []) {
      for (const action of presentation.actions) {
        if (action.purpose !== 'confirm_job' || action.value !== userMessage) continue;
        if (!action.id.startsWith(actionPrefix)) continue;
        const token = action.id.slice(actionPrefix.length).trim();
        if (token) return token;
      }
    }
  }
  return undefined;
}
