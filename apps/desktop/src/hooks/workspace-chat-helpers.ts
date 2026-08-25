import type { WorkflowViewState } from '@ax-studio/core';

export type WorkspaceWorkflowState = Partial<WorkflowViewState> & {
  title?: string;
  summary?: string;
  messages?: Array<{ role: string; content: string }>;
};
