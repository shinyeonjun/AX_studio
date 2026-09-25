import { lazy, Suspense, useState } from 'react';
import type { SettingsScreen, SidebarTab } from '../types/navigation';
import { useAppState } from './hooks/useAppState';
import { useWorkspaceChat } from '../features/chat/hooks/useWorkspaceChat';
import { useChatSessions } from '../features/chat/hooks/useChatSessions';
import { useAiDetection } from '../features/settings/hooks/ai-settings/useAiDetection';
import { useAiHub } from '../features/settings/hooks/useAiHub';
import { useTheme } from '../ui/hooks/useTheme';
import { WorkspaceSidebar } from '../ui/layout/WorkspaceSidebar';
import { StateBanner } from '../ui/layout/StateBanner';
import { createAppActions, retryFailedAppSources } from './actions';
import { AppMainContent } from './main-content';

const AppSettingsPage = lazy(() =>
  import('./settings-page').then(({ AppSettingsPage }) => ({ default: AppSettingsPage })),
);

export default function App() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('work');
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>('hub');
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [actionError, setActionError] = useState('');

  const { state, error: stateError, refresh, isLoading, isStale } = useAppState();
  const detection = useAiDetection();
  const { refreshDetection } = detection;
  const aiHub = useAiHub(state, refresh, detection);
  const { isDark, toggleTheme } = useTheme();
  const { sessions, error: sessionsError, refreshSessions } = useChatSessions();
  const workspaceChat = useWorkspaceChat({ refresh, onSessionsChanged: refreshSessions });

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
    <Suspense
      fallback={
        <div className="page-content">
          <p className="muted">설정을 불러오는 중…</p>
        </div>
      }
    >
      <AppSettingsPage
        screen={settingsScreen}
        onScreenChange={setSettingsScreen}
        state={state}
        onRefresh={refresh}
        detection={detection}
      />
    </Suspense>
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
        onOpenExecution={(execution) => {
          if (execution.workspaceSessionId) {
            setSidebarTab('work');
            setActiveSessionId(execution.workspaceSessionId);
            void workspaceChat.loadWorkspaceChat(execution.workspaceSessionId);
            return;
          }
          setSidebarTab('activity');
        }}
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
          error={stateError || actionError || detection.error || sessionsError}
          onRetry={() => {
            setActionError('');
            retryFailedAppSources({
              stateFailed: Boolean(stateError || isStale),
              sessionsFailed: Boolean(sessionsError),
              detectionFailed: Boolean(detection.error),
              actionFailed: Boolean(actionError),
              refresh,
              refreshSessions,
              refreshDetection,
            });
          }}
          onDismiss={actionError ? () => setActionError('') : undefined}
        />
        {mainContent}
      </main>
    </div>
  );
}
