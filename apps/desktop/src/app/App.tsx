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
import { SystemWarningBanner } from '../ui/layout/SystemWarningBanner';
import { UpdateNotice } from '../ui/layout/UpdateNotice';
import { ConfirmDialogHost } from '../ui/layout/ConfirmDialogHost';
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

  const { state, error: stateError, refresh, refreshForAction, isLoading, isStale } = useAppState();
  const detection = useAiDetection();
  const { refreshDetection } = detection;
  const aiHub = useAiHub(state, refresh, detection);
  const { isDark, toggleTheme } = useTheme();
  const { sessions, error: sessionsError, refreshSessions } = useChatSessions();
  const workspaceChat = useWorkspaceChat({ refresh, refreshAfterAction: refreshForAction, onSessionsChanged: refreshSessions });

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
      approvalRefresh={refreshForAction}
      workspaceChat={workspaceChat}
      settingsPage={settingsPage}
      onApprove={appActions.handleApprove}
      onReject={appActions.handleReject}
      onOpenSettings={openSettings}
      onRunWork={appActions.runWork}
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
        onRunWork={appActions.runWork}
        onDeleteWork={appActions.deleteWork}
        onOpenSettings={openSettings}
        aiHub={aiHub}
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
        <SystemWarningBanner state={state} />
        <UpdateNotice />
        {mainContent}
      </main>
      <ConfirmDialogHost />
    </div>
  );
}
