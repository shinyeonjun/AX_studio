import type { AppState } from '../../types/app-state';
import type { SettingsScreen, SidebarTab } from '../../types/navigation';
import type { ChatSessionSummary } from '../../hooks/useChatSessions';
import type { AiHubController } from '../../hooks/useAiHub';
import { axStudioLogo } from '../../constants/brand';
import { ThemeToggle } from './ThemeToggle';
import { SidebarNavigation } from './workspace-sidebar/navigation';
import { SidebarSettingsPanel } from './workspace-sidebar/settings-panel';
import { SidebarSessionList } from './workspace-sidebar/session-list';
import { SidebarStatusPanel } from './workspace-sidebar/status-panel';
import { SidebarWorkPanel } from './workspace-sidebar/work-panel';

interface WorkspaceSidebarProps {
  tab: SidebarTab;
  sessions: ChatSessionSummary[];
  activeSessionId?: string;
  pendingApprovals: number;
  state: AppState | null;
  aiHub: AiHubController;
  aiDetecting: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onTabChange: (tab: SidebarTab) => void;
  onNewChat: () => void;
  onSelectSession: (session: ChatSessionSummary) => void;
  onDeleteSession: (session: ChatSessionSummary) => void;
  onOpenWork: (workflowId: string) => void;
  onToggleWorkActive: (workflowId: string, active: boolean) => void;
  onDeleteWork: (workflowId: string, name: string) => void;
  onOpenSettings: (screen: SettingsScreen) => void;
}

export function WorkspaceSidebar({
  tab,
  sessions,
  activeSessionId,
  pendingApprovals,
  state,
  aiHub,
  aiDetecting,
  isDark,
  onToggleTheme,
  onTabChange,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onOpenWork,
  onToggleWorkActive,
  onDeleteWork,
  onOpenSettings,
}: WorkspaceSidebarProps) {
  return (
    <aside className="workspace-sidebar">
      <div className="workspace-sidebar-brand">
        <img src={axStudioLogo} alt="" className="brand-icon" />
        <span className="brand-text">AX Studio</span>
        <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
      </div>

      <SidebarNavigation
        tab={tab}
        pendingApprovals={pendingApprovals}
        onTabChange={onTabChange}
      />

      <div className="workspace-sidebar-panel scrollbar-overlay">
        {tab === 'work' && (
          <SidebarWorkPanel
            state={state}
            onOpenWork={onOpenWork}
            onToggleWorkActive={onToggleWorkActive}
            onDeleteWork={onDeleteWork}
          />
        )}

        {tab === 'approval' && (
          <SidebarStatusPanel kind="approval" pendingApprovals={pendingApprovals} />
        )}

        {tab === 'activity' && <SidebarStatusPanel kind="activity" />}

        {tab === 'settings' && (
          <SidebarSettingsPanel
            state={state}
            aiHub={aiHub}
            aiDetecting={aiDetecting}
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>

      <SidebarSessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewChat={onNewChat}
        onSelectSession={onSelectSession}
        onDeleteSession={onDeleteSession}
      />
    </aside>
  );
}
