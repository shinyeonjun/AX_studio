import { useEffect, useMemo, useState } from 'react';
import type { Tab, WorkFilter, WorkView, SettingsScreen } from './types/navigation';
import type { WorkSummary } from './types/app-state';
import { isOnceTrigger, isRecurringTrigger } from './lib/work-display';
import type { AiBrand } from './types/ai-provider';
import { useAppState } from './hooks/useAppState';
import { useInterview } from './hooks/useInterview';
import { useAiSettings } from './hooks/useAiSettings';
import { settingsScreenForBrand } from './constants/settings';
import { Sidebar } from './components/layout/Sidebar';
import { WorkPage } from './components/work/WorkPage';
import { ApprovalPage } from './components/approval/ApprovalPage';
import { ActivityPage } from './components/activity/ActivityPage';
import { SettingsPage } from './components/settings/SettingsPage';

export default function App() {
  const [tab, setTab] = useState<Tab>('work');
  const [workView, setWorkView] = useState<WorkView>('list');
  const [workFilter, setWorkFilter] = useState<WorkFilter>('all');
  const [search, setSearch] = useState('');
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>('hub');

  const { state, refresh } = useAppState();
  const interview = useInterview({
    refresh,
    onWorkSaved: () => setWorkView('list'),
  });
  const aiSettings = useAiSettings(state, refresh, () => {
    setSettingsScreen('ai');
  });

  useEffect(() => {
    if (tab !== 'settings') setSettingsScreen('hub');
  }, [tab]);

  useEffect(() => {
    if (tab !== 'work' && workView === 'conversation') {
      setWorkView('list');
    }
  }, [tab, workView]);

  const filteredWorks = useMemo(() => {
    if (!state?.works) return [];
    return state.works.filter((s) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.goal?.toLowerCase().includes(q) ?? false);
      const matchFilter =
        workFilter === 'all' ||
        (workFilter === 'running' && s.active) ||
        (workFilter === 'paused' && !s.active) ||
        (workFilter === 'once' && isOnceTrigger(s.trigger)) ||
        (workFilter === 'recurring' && isRecurringTrigger(s.trigger));
      return matchSearch && matchFilter;
    });
  }, [state?.works, search, workFilter]);

  const startNewTask = () => {
    interview.reset();
    setWorkView('conversation');
    setTab('work');
  };

  const openTask = async (workflowId: string) => {
    await interview.openWorkChat(workflowId);
    setWorkView('conversation');
    setTab('work');
  };

  const backToList = () => {
    interview.reset();
    setWorkView('list');
  };

  const openAiSettings = () => {
    setSettingsScreen('ai');
    void aiSettings.openAiHub();
  };

  const openAiBrand = (brand: AiBrand) => {
    setSettingsScreen(settingsScreenForBrand(brand));
    void aiSettings.openBrand(brand);
  };

  const toggleWork = async (work: WorkSummary) => {
    await window.ax.setWorkflowActive(work.id, !work.active);
    await refresh();
  };

  const runWorkflow = async (workflowId: string) => {
    await window.ax.runWorkflow(workflowId);
    await refresh();
  };

  const deleteWorkflow = async (workflowId: string) => {
    if (!window.confirm('이 업무를 삭제할까요?')) return;
    if (interview.interview?.workflowId === workflowId) {
      interview.reset();
      setWorkView('list');
    }
    await window.ax.deleteWorkflow(workflowId);
    await refresh();
  };

  return (
    <div className="app">
      <Sidebar
        tab={tab}
        pendingApprovals={state?.pendingApprovals ?? 0}
        onTabChange={setTab}
      />

      <main className="main">
        {tab === 'work' && (
          <WorkPage
            state={state}
            works={filteredWorks}
            workFilter={workFilter}
            search={search}
            view={workView}
            interview={interview}
            onWorkFilterChange={setWorkFilter}
            onSearchChange={setSearch}
            onNewTask={startNewTask}
            onOpenWork={openTask}
            onBackToList={backToList}
            onRunWorkflow={runWorkflow}
            onToggleWork={toggleWork}
            onDeleteWork={deleteWorkflow}
          />
        )}

        {tab === 'approval' && (
          <ApprovalPage
            approvals={state?.approvals ?? []}
            onApprove={(id) => window.ax.approve(id).then(refresh)}
            onReject={(id) => window.ax.reject(id).then(refresh)}
          />
        )}

        {tab === 'activity' && <ActivityPage state={state} onRefresh={refresh} />}

        {tab === 'settings' && (
          <SettingsPage
            screen={settingsScreen}
            state={state}
            aiSettings={aiSettings}
            onScreenChange={setSettingsScreen}
            onOpenAi={openAiSettings}
            onOpenAiBrand={openAiBrand}
            onConnectSlack={async (payload) => {
              await window.ax.connectSlack(payload);
              await refresh();
            }}
            onConnectGmail={() => window.ax.connectGmailOAuth().then(refresh)}
            onDisconnectGmail={() => window.ax.disconnectGmailOAuth().then(refresh)}
          />
        )}
      </main>
    </div>
  );
}
