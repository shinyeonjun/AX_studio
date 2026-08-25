import { useEffect, useState } from 'react';
import type { SettingsScreen, SidebarTab } from './types/navigation';
import { useAppState } from './hooks/useAppState';
import { useWorkspaceChat } from './hooks/useWorkspaceChat';
import { useChatSessions } from './hooks/useChatSessions';
import type { ChatSessionSummary } from './hooks/useChatSessions';
import { useAiDetection } from './hooks/ai-settings/useAiDetection';
import { useAiHub } from './hooks/useAiHub';
import { useTheme } from './hooks/useTheme';
import { WorkspaceSidebar } from './components/layout/WorkspaceSidebar';
import { ChatMainPage } from './components/chat/ChatMainPage';
import { ActivityPage } from './components/activity/ActivityPage';
import { ApprovalsPage } from './components/approval/ApprovalsPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { StateBanner } from './components/layout/StateBanner';
import { confirmDeleteChat, confirmDeleteWork } from './lib/confirm-delete';
import { ipcErrorMessage } from './lib/ipc-error';

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

  const startNewChat = () => {
    workspaceChat.startNewChat();
    setActiveSessionId(undefined);
    setSidebarTab('work');
  };

  const selectSession = async (session: ChatSessionSummary) => {
    setSidebarTab('work');
    setActiveSessionId(session.id);
    await workspaceChat.loadWorkspaceChat(session.id);
  };

  const deleteSession = async (session: ChatSessionSummary) => {
    if (!confirmDeleteChat(session.title)) return;

    const isActive =
      activeSessionId === session.id ||
      workspaceChat.workspaceSessionId === session.id ||
      (session.workflowId && workspaceChat.workspaceWorkflowState?.workflowId === session.workflowId);

    setActionError('');
    try {
      await window.ax.deleteWorkspaceChat(session.id);

      if (isActive) {
        workspaceChat.startNewChat();
        setActiveSessionId(undefined);
      }

      await refreshSessions();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '대화를 삭제하지 못했습니다.'));
    }
  };

  const openWork = async (workflowId: string) => {
    setSidebarTab('work');
    setActiveSessionId(undefined);
    await workspaceChat.openWorkChat(workflowId);
    await refreshSessions();
  };

  const deleteWork = async (workflowId: string, name: string) => {
    if (!confirmDeleteWork(name)) return;

    const isActiveWorkspaceWorkflow = workspaceChat.workspaceWorkflowState?.workflowId === workflowId;

    setActionError('');
    try {
      await window.ax.deleteWorkflow(workflowId);

      if (isActiveWorkspaceWorkflow) {
        workspaceChat.startNewChat();
        setActiveSessionId(undefined);
      }

      await refresh();
      await refreshSessions();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '업무를 삭제하지 못했습니다.'));
    }
  };

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

  const handleApprove = async (id: string) => {
    setActionError('');
    try {
      await window.ax.approve(id);
      await refresh();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '승인에 실패했습니다.'));
      throw err;
    }
  };

  const handleReject = async (id: string) => {
    setActionError('');
    try {
      await window.ax.reject(id);
      await refresh();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '거절에 실패했습니다.'));
      throw err;
    }
  };

  const toggleWorkActive = async (workflowId: string, active: boolean) => {
    setActionError('');
    try {
      await window.ax.setWorkflowActive(workflowId, active);
      await refresh();
    } catch (err) {
      setActionError(ipcErrorMessage(err, '업무 상태를 변경하지 못했습니다.'));
    }
  };

  const settingsPage = state ? (
    <SettingsPage
      screen={settingsScreen}
      onScreenChange={setSettingsScreen}
      state={state}
      onRefresh={refresh}
      onConnectSlack={async (payload) => {
        await window.ax.connectSlack(payload);
        await refresh();
      }}
      onDisconnectSlack={async () => {
        await window.ax.disconnectSlack();
        await refresh();
      }}
      onConnectGmail={() => window.ax.connectGmailOAuth().then(refresh)}
      onDisconnectGmail={() => window.ax.disconnectGmailOAuth().then(refresh)}
      onPickLocalFolder={() => window.ax.pickLocalFolder()}
      onAddLocalFolder={async (payload) => {
        await window.ax.addLocalFolder(payload);
        await refresh();
      }}
      onRemoveLocalFolder={async (folderId) => {
        await window.ax.removeLocalFolder(folderId);
        await refresh();
      }}
      onConnectHttp={async (payload) => {
        await window.ax.connectHttp(payload);
        await refresh();
      }}
      onDisconnectHttp={async (endpointId) => {
        await window.ax.disconnectHttp(endpointId);
        await refresh();
      }}
      onConnectWebhook={async (payload) => {
        await window.ax.connectWebhook(payload);
        await refresh();
      }}
      onDisconnectWebhook={async () => {
        await window.ax.disconnectWebhook();
        await refresh();
      }}
      onPickSqliteFile={() => window.ax.pickSqliteFile()}
      onConnectRdb={async (payload) => {
        await window.ax.connectRdb(payload);
        await refresh();
      }}
      onDisconnectRdb={async () => {
        await window.ax.disconnectRdb();
        await refresh();
      }}
      onConnectOpenApi={async (payload) => {
        await window.ax.connectOpenApi(payload);
        await refresh();
      }}
      onDisconnectOpenApi={async () => {
        await window.ax.disconnectOpenApi();
        await refresh();
      }}
      onConnectMcp={async (payload) => {
        await window.ax.connectMcp(payload);
        await refresh();
      }}
      onDisconnectMcp={async () => {
        await window.ax.disconnectMcp();
        await refresh();
      }}
    />
  ) : null;

  const mainContent = (() => {
    if (sidebarTab === 'activity') {
      return <ActivityPage state={state} onRefresh={refresh} />;
    }
    if (sidebarTab === 'approval') {
      return (
        <ApprovalsPage
          state={state}
          onRefresh={refresh}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      );
    }
    if (sidebarTab === 'settings') {
      return settingsPage ?? (
        <div className="page-content">
          <p className="muted">설정을 불러오는 중…</p>
        </div>
      );
    }
    return <ChatMainPage workspaceChat={workspaceChat} />;
  })();

  return (
    <div className="app app--workspace">
      <WorkspaceSidebar
        tab={sidebarTab}
        sessions={sessions}
      activeSessionId={activeSessionId ?? workspaceChat.workspaceSessionId}
        pendingApprovals={state?.pendingApprovals ?? 0}
        state={state}
        onTabChange={handleTabChange}
        onNewChat={startNewChat}
        onSelectSession={selectSession}
        onDeleteSession={deleteSession}
        onOpenWork={openWork}
        onToggleWorkActive={toggleWorkActive}
        onDeleteWork={deleteWork}
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
