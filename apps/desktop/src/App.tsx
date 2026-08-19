import { useEffect, useMemo, useState } from 'react';
import type { Tab, WorkFilter, SettingsScreen } from './types/navigation';
import type { SkillSummary } from './types/app-state';
import type { AiBrand } from './types/ai-provider';
import { useAppState } from './hooks/useAppState';
import { useInterview } from './hooks/useInterview';
import { useAiSettings } from './hooks/useAiSettings';
import { settingsScreenForBrand } from './constants/settings';
import { Sidebar } from './components/layout/Sidebar';
import { WorkPage } from './components/work/WorkPage';
import { ChatPage } from './components/chat/ChatPage';
import { ApprovalPage } from './components/approval/ApprovalPage';
import { ActivityPage } from './components/activity/ActivityPage';
import { SettingsPage } from './components/settings/SettingsPage';

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [workFilter, setWorkFilter] = useState<WorkFilter>('all');
  const [search, setSearch] = useState('');
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>('hub');

  const { state, refresh } = useAppState();
  const interview = useInterview(refresh, setTab);
  const aiSettings = useAiSettings(state, refresh, () => {
    setSettingsScreen('ai');
  });

  useEffect(() => {
    if (tab !== 'settings') setSettingsScreen('hub');
  }, [tab]);

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
        (workFilter === 'paused' && !s.active);
      return matchSearch && matchFilter;
    });
  }, [state?.skills, search, workFilter]);

  const startNewTask = () => {
    setTab('chat');
    interview.reset();
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
            onWorkFilterChange={setWorkFilter}
            onSearchChange={setSearch}
            onNewTask={startNewTask}
            onRunSkill={runSkill}
            onToggleSkill={toggleSkill}
          />
        )}

        {tab === 'chat' && (
          <ChatPage
            interview={interview.interview}
            saved={interview.saved}
            busy={interview.busy}
            error={interview.error}
            progress={interview.progress}
            instruction={interview.instruction}
            answer={interview.answer}
            onInstructionChange={interview.setInstruction}
            onAnswerChange={interview.setAnswer}
            onStartInterview={interview.startInterview}
            onSendAnswer={interview.sendAnswer}
            onTestRun={interview.testRun}
            onSaveAndRun={interview.saveAndRun}
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
