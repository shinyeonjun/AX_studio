import type { ChatSessionSummary } from '../../hooks/useChatSessions';
import type { WorkspaceWorkflowState } from '../../hooks/useWorkspaceChat';
import type { SidebarTab } from '../../types/navigation';

export interface WorkspaceChatActions {
  workspaceSessionId?: string;
  workspaceWorkflowState: WorkspaceWorkflowState | null;
  startNewChat: () => void;
  loadWorkspaceChat: (sessionId: string) => Promise<void>;
  openWorkChat: (workflowId: string) => Promise<void>;
}

export interface AppActions {
  startNewChat: () => void;
  selectSession: (session: ChatSessionSummary) => Promise<void>;
  deleteSession: (session: ChatSessionSummary) => Promise<void>;
  openWork: (workflowId: string) => Promise<void>;
  deleteWork: (workflowId: string, name: string) => Promise<void>;
  handleApprove: (id: string) => Promise<void>;
  handleReject: (id: string) => Promise<void>;
  toggleWorkActive: (workflowId: string, active: boolean) => Promise<void>;
}

export interface AppActionContext {
  activeSessionId?: string;
  workspaceChat: WorkspaceChatActions;
  refresh: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  setActiveSessionId: (id: string | undefined) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setActionError: (message: string) => void;
}

export type AppSessionActionContext = Pick<
  AppActionContext,
  | 'activeSessionId'
  | 'workspaceChat'
  | 'refreshSessions'
  | 'setActiveSessionId'
  | 'setSidebarTab'
  | 'setActionError'
>;

export type AppWorkActionContext = Pick<
  AppActionContext,
  | 'workspaceChat'
  | 'refresh'
  | 'refreshSessions'
  | 'setActiveSessionId'
  | 'setSidebarTab'
  | 'setActionError'
>;

export type AppApprovalActionContext = Pick<AppActionContext, 'refresh' | 'setActionError'>;
