import { lazy, Suspense, type ReactNode } from 'react';
import type { AppState } from '../types/app-state';
import type { SidebarTab } from '../types/navigation';
import type { useWorkspaceChat } from '../features/chat/hooks/useWorkspaceChat';
import { ChatMainPage } from '../features/chat/ui/ChatMainPage';

const ActivityPage = lazy(() =>
  import('../features/activity/ui/ActivityPage').then(({ ActivityPage }) => ({ default: ActivityPage })),
);
const ApprovalsPage = lazy(() =>
  import('../features/activity/ui/approval/ApprovalsPage').then(({ ApprovalsPage }) => ({ default: ApprovalsPage })),
);

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
    return (
      <Suspense
        fallback={
          <div className="page-content">
            <p className="muted">활동을 불러오는 중…</p>
          </div>
        }
      >
        <ActivityPage state={state} onRefresh={refresh} />
      </Suspense>
    );
  }
  if (tab === 'approval') {
    return (
      <Suspense
        fallback={
          <div className="page-content">
            <p className="muted">승인을 불러오는 중…</p>
          </div>
        }
      >
        <ApprovalsPage state={state} onRefresh={refresh} onApprove={onApprove} onReject={onReject} />
      </Suspense>
    );
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
