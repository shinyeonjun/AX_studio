export interface WorkspaceChatChangedEvent {
  sessionId: string;
  workflowId?: string;
  executionId: string;
}
