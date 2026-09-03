import type { ReactNode } from 'react';
import type { AppState } from '../types/app-state';
import type { SidebarTab } from '../types/navigation';
import type { useWorkspaceChat } from '../hooks/useWorkspaceChat';
import { ActivityPage } from '../components/activity/ActivityPage';
import { ApprovalsPage } from '../components/approval/ApprovalsPage';
import { ChatMainPage } from '../components/chat/ChatMainPage';

type WorkspaceChatApi = ReturnType<typeof useWorkspaceChat>;

interface AppMainContentProps {
  tab: SidebarTab;
  state: AppState | null;
  refresh: () => Promise<void>;
  workspaceChat: WorkspaceChatApi;
  settingsPage: ReactNode;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function AppMainContent({
  tab,
  state,
  refresh,
  workspaceChat,
  settingsPage,
  onApprove,
  onReject,
}: AppMainContentProps) {
  if (tab === 'activity') {
    return <ActivityPage state={state} onRefresh={refresh} />;
  }
  if (tab === 'approval') {
    return <ApprovalsPage state={state} onRefresh={refresh} onApprove={onApprove} onReject={onReject} />;
  }
  if (tab === 'settings') {
    return (
      settingsPage ?? (
        <div className="page-content">
          <p className="muted">설정을 불러오는 중…</p>
        </div>
      )
    );
  }
  return <ChatMainPage workspaceChat={workspaceChat} />;
}
