import type { ExecutionResult, ToolResultConfirmation, WorkspaceChatMessage } from '@ax-studio/core';

export interface ToolResultPaneProps {
  message: WorkspaceChatMessage;
  busy: boolean;
  active?: boolean;
  onConfirm: (confirmation: ToolResultConfirmation) => Promise<ExecutionResult>;
  onCancel: (approvalId: string) => Promise<void>;
}
