import type {
  AxInputRequest,
  AxUiPresentation,
  WorkspaceChatChangedEvent,
  WorkspaceChatMessage,
  WorkspaceChatRecord,
  WorkspaceSourceRecord,
} from '@ax-studio/core';

export interface AxWorkspaceApi {
  sendCommandChat: (
    messages: WorkspaceChatMessage[],
    requestId?: string,
    workflowId?: string,
    workspaceSessionId?: string,
  ) => Promise<{
    role: 'assistant';
    content: string;
    requestId: string;
    changedWorkflowIds: string[];
    removedWorkflowIds: string[];
    inputRequests: AxInputRequest[];
    presentations: AxUiPresentation[];
  }>;
  cancelChat: (requestId: string) => Promise<{ ok: boolean }>;
  listChatSessions: () => Promise<
    Array<{
      id: string;
      title: string;
      updatedAt: string;
      kind: 'workspace';
      workflowId?: string;
      corrupted?: boolean;
      sourceCount?: number;
    }>
  >;
  saveWorkspaceChat: (
    id: string | undefined,
    messages: WorkspaceChatMessage[],
    workflowId?: string | null,
  ) => Promise<WorkspaceChatRecord>;
  loadWorkspaceChat: (id: string) => Promise<WorkspaceChatRecord>;
  loadWorkspaceChatByWorkflowId: (workflowId: string) => Promise<WorkspaceChatRecord | null>;
  deleteWorkspaceChat: (id: string) => Promise<{ ok: boolean }>;
  listWorkspaceSources: (sessionId: string) => Promise<{
    ok: boolean;
    sources: WorkspaceSourceRecord[];
  }>;
  attachWorkspaceSource: (sessionId?: string | null) => Promise<
    | { ok: true; sessionId: string; title: string; source: WorkspaceSourceRecord }
    | { ok: false; canceled?: boolean; error?: string }
  >;
  e2eSetWorkspaceSourcePath?: (filePath: string) => Promise<{ ok: true }>;
  onChatProgress?: (listener: (event: { message: string; requestId?: string }) => void) => () => void;
  explain: (q: string) => Promise<string>;
  onWorkspaceSourceChanged: (listener: (event: {
    sessionId: string;
    source: WorkspaceSourceRecord;
  }) => void) => () => void;
  onWorkspaceChatChanged: (listener: (event: WorkspaceChatChangedEvent) => void) => () => void;
}
