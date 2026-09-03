import type { AxUiPresentation, WorkspaceChatMessage } from '@ax-studio/core';

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

function isConfirmation(
  messages: WorkspaceChatMessage[],
  userMessage: string,
  purpose: AxUiPresentation['actions'][number]['purpose'],
): boolean {
  return messages.slice(0, -1).some((message) =>
    message.role === 'assistant' && message.presentations?.some((presentation) =>
      presentation.actions.some((action) => action.purpose === purpose && action.value === userMessage),
    ),
  );
}

export function isContextConfirmation(messages: WorkspaceChatMessage[], userMessage: string): boolean {
  return isConfirmation(messages, userMessage, 'confirm_context');
}

export function isJobConfirmation(messages: WorkspaceChatMessage[], userMessage: string): boolean {
  return isConfirmation(messages, userMessage, 'confirm_job');
}
