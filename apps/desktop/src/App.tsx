import { useEffect, useState } from 'react';
import type { SettingsScreen, SidebarTab } from './types/navigation';
import { useAppState } from './hooks/useAppState';
import { useWorkspaceChat } from './hooks/useWorkspaceChat';
import { useChatSessions } from './hooks/useChatSessions';
import { useAiDetection } from './hooks/ai-settings/useAiDetection';
import { useAiHub } from './hooks/useAiHub';
import { useTheme } from './hooks/useTheme';
import { WorkspaceSidebar } from './components/layout/WorkspaceSidebar';
import { StateBanner } from './components/layout/StateBanner';
import { createAppActions } from './app/actions';
import { AppMainContent } from './app/main-content';
import { AppSettingsPage } from './app/settings-page';

export default function App() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('work');
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>('hub');
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [actionError, setActionError] = useState('');

  const { state, error: stateError, refresh, isLoading, isStale } = useAppState();
  const detection = useAiDetection();
  const aiHub = useAiHub(state, refresh, detection);
  const { isDark, toggleTheme } = useTheme();
  const { sessions, refreshSessions } = useChatSessions();
  const workspaceChat = useWorkspaceChat({ refresh, onSessionsChanged: refreshSessions });

  useEffect(() => {
    void detection.refreshDetection();
  }, []);

  const appActions = createAppActions({
    activeSessionId,
    workspaceChat,
    refresh,
    refreshSessions,
    setActiveSessionId,
    setSidebarTab,
    setActionError,
  });

  const openSettings = (screen: SettingsScreen) => {
    setSidebarTab('settings');
    setSettingsScreen(screen);
  };

  const handleTabChange = (nextTab: SidebarTab) => {
    setSidebarTab(nextTab);
    if (nextTab === 'settings') {
      setSettingsScreen((current) => current ?? 'hub');
    }
  };

  const settingsPage = state ? (
    <AppSettingsPage
      screen={settingsScreen}
      onScreenChange={setSettingsScreen}
      state={state}
      onRefresh={refresh}
    />
  ) : null;

  const mainContent = (
    <AppMainContent
      tab={sidebarTab}
      state={state}
      refresh={refresh}
      workspaceChat={workspaceChat}
      settingsPage={settingsPage}
      onApprove={appActions.handleApprove}
      onReject={appActions.handleReject}
    />
  );

  return (
    <div className="app app--workspace">
      <WorkspaceSidebar
        tab={sidebarTab}
        sessions={sessions}
      activeSessionId={activeSessionId ?? workspaceChat.workspaceSessionId}
        pendingApprovals={state?.pendingApprovals ?? 0}
        state={state}
        onTabChange={handleTabChange}
        onNewChat={appActions.startNewChat}
        onSelectSession={appActions.selectSession}
        onDeleteSession={appActions.deleteSession}
        onOpenWork={appActions.openWork}
        onToggleWorkActive={appActions.toggleWorkActive}
        onDeleteWork={appActions.deleteWork}
        onOpenSettings={openSettings}
        aiHub={aiHub}
        aiDetecting={detection.detecting}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />

      <main className="main main--workspace" id="workspace-main-panel">
        <StateBanner
          loading={isLoading}
          stale={isStale}
          error={stateError || actionError}
          onRetry={() => {
            setActionError('');
            void refresh();
          }}
          onDismiss={actionError ? () => setActionError('') : undefined}
        />
        {mainContent}
      </main>
    </div>
  );
}
