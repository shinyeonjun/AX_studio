import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  AxInputRequest,
  AxUiPresentation,
  WorkspaceChatMessage,
  WorkspaceSourceRecord,
  TableArtifact,
  WorkspaceChatPersistedReplyReceipt,
} from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../workspace-chat-helpers';

interface WorkspaceChatRefs {
  sessionEpochRef: MutableRefObject<number>;
  workspaceSessionIdRef: MutableRefObject<string | undefined>;
  activeRequestIdRef: MutableRefObject<string | undefined>;
  busyRef: MutableRefObject<boolean>;
  sourceBusyRef: MutableRefObject<boolean>;
  pendingWorkspaceChatRefreshRef: MutableRefObject<string | undefined>;
  transcriptRevisionRef?: MutableRefObject<string | undefined>;
}

/** One render snapshot owns both its messages and the token for those messages. */
export interface WorkspaceChatTranscriptSnapshot {
  readonly messages: WorkspaceChatMessage[];
  readonly transcriptRevision?: string;
}

export interface WorkspaceChatContext {
  refs: WorkspaceChatRefs;
  chatMessages: WorkspaceChatMessage[];
  transcriptSnapshot?: WorkspaceChatTranscriptSnapshot;
  setTranscriptSnapshot?: Dispatch<SetStateAction<WorkspaceChatTranscriptSnapshot>>;
  workspaceWorkflowState: WorkspaceWorkflowState | null;
  refresh: () => Promise<void>;
  refreshAfterAction?: () => Promise<void>;
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
  refreshMappedWorkspaceChat: (sessionId: string) => Promise<void | boolean>;
}

export interface WorkspaceSendResponse {
  role: 'assistant';
  content: string;
  requestId?: string;
  persistedReply?: WorkspaceChatPersistedReplyReceipt;
  metadataStop?: string;
  changedWorkflowIds?: string[];
  removedWorkflowIds?: string[];
  inputContinuation?: 'command';
  inputRequests?: AxInputRequest[];
  presentations?: AxUiPresentation[];
  readResult?: TableArtifact;
  dbConnection?: WorkspaceChatMessage['dbConnection'];
}
