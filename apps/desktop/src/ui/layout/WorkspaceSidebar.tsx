import type { AppState } from '../../types/app-state';
import { useState } from 'react';
import type { SettingsScreen, SidebarTab } from '../../types/navigation';
import type { ChatSessionSummary } from '../../features/chat/hooks/useChatSessions';
import type { AiHubController } from '../../features/settings/hooks/useAiHub';
import { axStudioLogo } from '../constants/brand';
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
  onOpenExecution: (execution: AppState['executions'][number]) => void;
  onToggleWorkActive: (workflowId: string, active: boolean) => void | Promise<void>;
  onRunWork: (workflowId: string) => Promise<void>;
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
  onOpenExecution,
  onToggleWorkActive,
  onRunWork,
  onDeleteWork,
  onOpenSettings,
}: WorkspaceSidebarProps) {
  const [navigationExpanded, setNavigationExpanded] = useState(false);
  return (
    <aside className={'workspace-sidebar' + (navigationExpanded ? ' workspace-sidebar--expanded' : '')}>
      <div className="workspace-sidebar-brand">
        <img src={axStudioLogo} alt="" className="brand-icon" />
        <span className="brand-text">AX Studio</span>
        <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
      </div>
      <button type="button" className="tool-result-mobile-navigation" aria-expanded={navigationExpanded}
        aria-controls="workspace-sidebar-result-navigation" onClick={() => setNavigationExpanded(value => !value)}>
        {navigationExpanded ? '대화와 업무 목록 닫기' : '대화와 업무 목록 열기'}
      </button>

      <SidebarNavigation
        tab={tab}
        pendingApprovals={pendingApprovals}
        onTabChange={onTabChange}
      />

      <div id="workspace-sidebar-result-navigation" className="tool-result-sidebar-navigation">
      <div className="workspace-sidebar-panel scrollbar-overlay">
        {tab === 'work' && (
          <SidebarWorkPanel
            state={state}
            sessions={sessions}
            onOpenWork={id => { setNavigationExpanded(false); onOpenWork(id); }}
            onOpenExecution={execution => { setNavigationExpanded(false); onOpenExecution(execution); }}
            onToggleWorkActive={onToggleWorkActive}
            onRunWork={onRunWork}
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
        onNewChat={() => { setNavigationExpanded(false); onNewChat(); }}
        onSelectSession={session => { setNavigationExpanded(false); onSelectSession(session); }}
        onDeleteSession={onDeleteSession}
      />
      </div>
    </aside>
  );
}
