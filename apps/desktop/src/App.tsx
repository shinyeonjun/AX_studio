import { useEffect, useMemo, useState } from 'react';
import type { Tab, WorkFilter, WorkView, SettingsScreen } from './types/navigation';
import type { SkillSummary } from './types/app-state';
import { isOnceTrigger, isRecurringTrigger } from './lib/skill-display';
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

  const filteredSkills = useMemo(() => {
    if (!state?.skills) return [];
    return state.skills.filter((s) => {
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
  }, [state?.skills, search, workFilter]);

  const startNewTask = () => {
    interview.reset();
    setWorkView('conversation');
    setTab('work');
  };

  const openTask = async (skillId: string) => {
    await interview.openSkillChat(skillId);
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

  const toggleSkill = async (skill: SkillSummary) => {
    await window.ax.setSkillActive(skill.id, !skill.active);
    await refresh();
  };

  const runSkill = async (skillId: string) => {
    await window.ax.runSkill(skillId);
    await refresh();
  };

  const deleteSkill = async (skillId: string) => {
    if (!window.confirm('이 업무를 삭제할까요?')) return;
    if (interview.interview?.skillId === skillId) {
      interview.reset();
      setWorkView('list');
    }
    await window.ax.deleteSkill(skillId);
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
            skills={filteredSkills}
            workFilter={workFilter}
            search={search}
            view={workView}
            interview={interview}
            onWorkFilterChange={setWorkFilter}
            onSearchChange={setSearch}
            onNewTask={startNewTask}
            onOpenTask={openTask}
            onBackToList={backToList}
            onRunSkill={runSkill}
            onToggleSkill={toggleSkill}
            onDeleteSkill={deleteSkill}
          />
        )}

        {tab === 'approval' && (
          <ApprovalPage
            approvals={state?.approvals ?? []}
            onApprove={(id) => window.ax.approve(id).then(refresh)}
            onReject={(id) => window.ax.reject(id).then(refresh)}
          />
        )}

        {tab === 'activity' && <ActivityPage state={state} />}

        {tab === 'settings' && (
          <SettingsPage
            screen={settingsScreen}
            state={state}
            aiSettings={aiSettings}
            onScreenChange={setSettingsScreen}
            onOpenAi={openAiSettings}
            onOpenAiBrand={openAiBrand}
            onConnectSlack={(token) => window.ax.connectSlack(token).then(refresh)}
            onConnectGmail={() => window.ax.connectGmailOAuth().then(refresh)}
            onDisconnectGmail={() => window.ax.disconnectGmailOAuth().then(refresh)}
          />
        )}
      </main>
    </div>
  );
}
