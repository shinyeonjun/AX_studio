import type { WorkflowViewState } from '@ax-studio/core';

export type WorkspaceWorkflowState = Partial<WorkflowViewState> & {
  title?: string;
  summary?: string;
  messages?: Array<{ role: string; content: string }>;
};

export function workspaceChatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '대화 처리에 실패했습니다.';
}

export async function hydrateWorkflowSummary(state: WorkspaceWorkflowState): Promise<WorkspaceWorkflowState> {
  return state;
}
