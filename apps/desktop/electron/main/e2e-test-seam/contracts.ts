import type { AxInputRequest, AxStudioCore, AxUiPresentation } from '@ax-studio/core';

export interface E2EChatReply {
  content: string;
  changedWorkflowIds: string[];
  removedWorkflowIds: string[];
  inputRequests: AxInputRequest[];
  presentations: AxUiPresentation[];
}

export interface E2EChatRequest {
  core: AxStudioCore;
  userMessage: string;
  workspaceSessionId?: string;
}
