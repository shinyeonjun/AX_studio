import { useEffect, useState } from 'react';
import type { SettingsScreen, SidebarTab } from './types/navigation';
import { useAppState } from './hooks/useAppState';
import { useInterview } from './hooks/useInterview';
import { useChatSessions } from './hooks/useChatSessions';
import type { ChatSessionSummary } from './hooks/useChatSessions';
import { useAiDetection } from './hooks/ai-settings/useAiDetection';
import { useAiHub } from './hooks/useAiHub';
import { useTheme } from './hooks/useTheme';
import { WorkspaceSidebar } from './components/layout/WorkspaceSidebar';
import { ChatMainPage } from './components/chat/ChatMainPage';
import { ActivityPage } from './components/activity/ActivityPage';
import { SettingsPage } from './components/settings/SettingsPage';

export default function App() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('work');
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();

  const { state, refresh } = useAppState();
  const detection = useAiDetection();
  const aiHub = useAiHub(state, refresh, detection);
  const { isDark, toggleTheme } = useTheme();
  const { sessions, refreshSessions } = useChatSessions();
  const interview = useInterview({ refresh, onSessionsChanged: refreshSessions });

  useEffect(() => {
    void detection.refreshDetection();
  }, []);

  const startNewChat = () => {
    interview.startNewChat();
    setActiveSessionId(undefined);
    setSettingsScreen(null);
    setSidebarTab('work');
  };

  const selectSession = async (session: ChatSessionSummary) => {
    setSettingsScreen(null);
    setSidebarTab('work');
    setActiveSessionId(session.id);
    if (session.kind === 'interview' && session.workflowId) {
      await interview.openWorkChat(session.workflowId);
      return;
    }
    if (session.kind === 'interview') {
      await interview.openInterviewChat(session.id);
      return;
    }
    await interview.loadWorkspaceChat(session.id);
  };

  const deleteSession = async (session: ChatSessionSummary) => {
    const isActive =
      activeSessionId === session.id ||
      interview.workspaceSessionId === session.id ||
      (session.kind === 'interview' &&
        session.workflowId &&
        interview.interview?.workflowId === session.workflowId);

    if (session.kind === 'workspace') {
      await window.ax.deleteWorkspaceChat(session.id);
    } else if (session.workflowId) {
      await window.ax.deleteWorkflow(session.workflowId);
      await refresh();
    } else {
      await window.ax.deleteInterviewChatSession(session.id);
    }

    if (isActive) {
      interview.startNewChat();
      setActiveSessionId(undefined);
      setSettingsScreen(null);
    }

    await refreshSessions();
  };

  const openWork = async (workflowId: string) => {
    setSettingsScreen(null);
    setSidebarTab('work');
    setActiveSessionId(undefined);
    await interview.openWorkChat(workflowId);
    await refreshSessions();
  };

  const deleteWork = async (workflowId: string) => {
    const isActive = interview.interview?.workflowId === workflowId;

    await window.ax.deleteWorkflow(workflowId);

    if (isActive) {
      interview.startNewChat();
      setActiveSessionId(undefined);
      setSettingsScreen(null);
    }

    await refresh();
    await refreshSessions();
  };

  const openSettings = (screen: SettingsScreen) => {
    setSidebarTab('settings');
    setSettingsScreen(screen);
  };

  const handleTabChange = (nextTab: SidebarTab) => {
    setSidebarTab(nextTab);
    if (nextTab !== 'settings') setSettingsScreen(null);
  };

  const handleApprove = async (id: string) => {
    await window.ax.approve(id);
    await refresh();
  };

  const handleReject = async (id: string) => {
    await window.ax.reject(id);
    await refresh();
  };

  const toggleWorkActive = async (workflowId: string, active: boolean) => {
    await window.ax.setWorkflowActive(workflowId, active);
    await refresh();
  };

  const settingsContent =
    settingsScreen && state ? (
      <SettingsPage
        screen={settingsScreen}
        onScreenChange={setSettingsScreen}
        state={state}
        onRefresh={refresh}
        onConnectSlack={async (payload) => {
          await window.ax.connectSlack(payload);
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
        onDisconnectHttp={async () => {
          await window.ax.disconnectHttp();
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
      />
    ) : null;

  return (
    <div className="app app--workspace">
      <WorkspaceSidebar
        tab={sidebarTab}
        sessions={sessions}
        activeSessionId={activeSessionId ?? interview.workspaceSessionId}
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
        onApprove={handleApprove}
        onReject={handleReject}
        aiHub={aiHub}
        aiDetecting={detection.detecting}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />

      <main className="main main--chat">
        {sidebarTab === 'activity' ? (
          <ActivityPage state={state} onRefresh={refresh} />
        ) : (
          <ChatMainPage
            interview={interview}
            settingsScreen={settingsScreen}
            onCloseSettings={() => setSettingsScreen(null)}
            settingsContent={settingsContent}
          />
        )}
      </main>
    </div>
  );
}
