import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  AxInputRequest,
  AxUiPresentation,
  WorkspaceChatMessage,
  WorkspaceSourceRecord,
} from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../workspace-chat-helpers';

export interface WorkspaceChatRefs {
  sessionEpochRef: MutableRefObject<number>;
  workspaceSessionIdRef: MutableRefObject<string | undefined>;
  activeRequestIdRef: MutableRefObject<string | undefined>;
  busyRef: MutableRefObject<boolean>;
  sourceBusyRef: MutableRefObject<boolean>;
  pendingWorkspaceChatRefreshRef: MutableRefObject<string | undefined>;
}

export interface WorkspaceChatContext {
  refs: WorkspaceChatRefs;
  chatMessages: WorkspaceChatMessage[];
  workspaceWorkflowState: WorkspaceWorkflowState | null;
  refresh: () => Promise<void>;
  onSessionsChanged?: () => void;
  isCurrentSession: (epoch: number) => boolean;
  isViewingSession: (sessionId: string | undefined) => boolean;
  setWorkspaceContextKey: Dispatch<SetStateAction<number>>;
  setWorkspaceSessionId: Dispatch<SetStateAction<string | undefined>>;
  setChatMessages: Dispatch<SetStateAction<WorkspaceChatMessage[]>>;
  setWorkspaceWorkflowState: Dispatch<SetStateAction<WorkspaceWorkflowState | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setProgress: Dispatch<SetStateAction<string>>;
  setEditHint: Dispatch<SetStateAction<string | null>>;
  setWorkflowRegistered: Dispatch<SetStateAction<boolean>>;
  workflowRegistered: boolean;
  setWorkspaceSources: Dispatch<SetStateAction<WorkspaceSourceRecord[]>>;
  setSourceBusy: Dispatch<SetStateAction<boolean>>;
}

export interface WorkspaceChatMessageContext extends WorkspaceChatContext {
  refreshMappedWorkspaceChat: (sessionId: string) => Promise<void>;
}

export interface WorkspaceSendResponse {
  role: 'assistant';
  content: string;
  changedWorkflowIds?: string[];
  removedWorkflowIds?: string[];
  inputRequests?: AxInputRequest[];
  presentations?: AxUiPresentation[];
}
