import type { AppState, SkillSummary } from '../../types/app-state';
import type { WorkFilter } from '../../types/navigation';
import type { useInterview } from '../../hooks/useInterview';
import { connectorEmoji, connectorLabel } from '../../constants/connectors';
import { formatRelativeTime, triggerLabel } from '../../lib/skill-display';
import { IconPlay, IconPause } from '../icons';
import { PageHeader } from '../layout/PageHeader';
import { IconSearch } from '../icons';
import { ChatPanel } from './ChatPanel';

type InterviewApi = ReturnType<typeof useInterview>;

interface TaskCardProps {
  skill: SkillSummary;
  globalActive: boolean;
  onOpen: () => void;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function TaskCard({ skill, globalActive, onOpen, onRun, onToggle, onDelete }: TaskCardProps) {
  const statusLabel = !globalActive ? '퇴근 중' : skill.active ? '실행 중' : '중지됨';
  const statusClass = !globalActive ? 'off-duty' : skill.active ? 'running' : 'paused';

  return (
    <div className={`task-card ${!skill.active ? 'paused' : ''}`}>
      <button type="button" className="task-card-main" onClick={onOpen}>
        <div className="task-icon-wrap">{connectorEmoji(skill.connectors?.[0] ?? 'gmail')}</div>
        <div className="task-body">
          <h3 className="task-title">{skill.name}</h3>
          <p className="task-desc">{skill.goal || '설명 없음'}</p>
          <div className="task-meta">
            <div className="connector-badges">
              {(skill.connectors ?? []).map((c) => (
                <span key={c} className="connector-badge">
                  {connectorEmoji(c)} {connectorLabel(c)}
                </span>
              ))}
            </div>
            <span className="status-pill">
              <span className={`status-dot ${statusClass}`} />
              {statusLabel}
            </span>
            <span className="meta-time">
              {triggerLabel(skill.trigger)} · 최근 {formatRelativeTime(skill.lastRunAt)}
            </span>
          </div>
        </div>
      </button>
      <div className="task-actions">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          title="지금 실행"
        >
          실행
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost btn-danger-text"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="업무 삭제"
        >
          삭제
        </button>
        <button
          type="button"
          className={`play-toggle ${skill.active ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={skill.active ? '업무 중지' : '업무 활성화'}
          aria-label={skill.active ? '중지' : '활성화'}
        >
          {skill.active ? <IconPause /> : <IconPlay />}
        </button>
      </div>
    </div>
  );
}

interface WorkPageProps {
  state: AppState | null;
  skills: SkillSummary[];
  workFilter: WorkFilter;
  search: string;
  view: 'list' | 'conversation';
  interview: InterviewApi;
  onWorkFilterChange: (filter: WorkFilter) => void;
  onSearchChange: (value: string) => void;
  onNewTask: () => void;
  onOpenTask: (skillId: string) => void;
  onBackToList: () => void;
  onRunSkill: (skillId: string) => void;
  onToggleSkill: (skill: SkillSummary) => void;
  onDeleteSkill: (skillId: string) => void;
}

export function WorkPage({
  state,
  skills,
  workFilter,
  search,
  view,
  interview,
  onWorkFilterChange,
  onSearchChange,
  onNewTask,
  onOpenTask,
  onBackToList,
  onRunSkill,
  onToggleSkill,
  onDeleteSkill,
}: WorkPageProps) {
  if (view === 'conversation') {
    const title = interview.interview?.title ?? (interview.interview?.skillId ? '업무' : '새 업무');
    const isDraft = !interview.interview?.skillId;

    return (
      <div className="work-conversation-page">
        <header className="work-conversation-header">
          <button type="button" className="btn btn-ghost settings-back" onClick={onBackToList}>
            ← 업무 목록
          </button>
          <div className="work-conversation-title-wrap">
            <h1 className="work-conversation-title">{title}</h1>
            {isDraft && <span className="draft-badge">임시</span>}
          </div>
        </header>
        <ChatPanel
          interview={interview.interview}
          busy={interview.busy}
          error={interview.error}
          progress={interview.progress}
          composerText={interview.composerText}
          isLinkedSkill={interview.isLinkedSkill}
          isImmediateOnce={interview.isImmediateOnce}
          isDeferredOnce={interview.isDeferredOnce}
          isRecurringDraft={interview.isRecurringDraft}
          onComposerChange={interview.setComposerText}
          onStartInterview={interview.startInterview}
          onSendAnswer={interview.sendAnswer}
          onRunOnce={interview.runOnce}
          onSaveAsWork={interview.saveAsWork}
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="업무"
        subtitle="맡긴 업무를 관리하고 대화로 수정할 수 있습니다"
        action={
          <button type="button" className="btn btn-primary" onClick={onNewTask}>
            + 새 업무
          </button>
        }
      />
      <div className="page-content">
        {skills.length > 0 && (
          <div className="toolbar">
            <div className="search-box">
              <IconSearch />
              <input placeholder="업무 검색..." value={search} onChange={(e) => onSearchChange(e.target.value)} />
            </div>
            <select
              className="filter-select"
              value={workFilter}
              onChange={(e) => onWorkFilterChange(e.target.value as WorkFilter)}
            >
              <option value="all">전체</option>
              <option value="recurring">반복 업무</option>
              <option value="once">1회성</option>
              <option value="running">실행 중</option>
              <option value="paused">중지됨</option>
            </select>
          </div>
        )}

        {skills.length === 0 ? (
          <div className="empty-state work-empty-state">
            <p>아직 맡긴 업무가 없습니다</p>
            <p className="muted">새 업무 대화를 시작해 AX에게 맡겨보세요.</p>
            <button type="button" className="btn btn-primary" onClick={onNewTask}>
              새 업무 대화 시작
            </button>
          </div>
        ) : (
          <div className="task-list">
            {skills.map((skill) => (
              <TaskCard
                key={skill.id}
                skill={skill}
                globalActive={state?.globalActive ?? true}
                onOpen={() => onOpenTask(skill.id)}
                onRun={() => onRunSkill(skill.id)}
                onToggle={() => onToggleSkill(skill)}
                onDelete={() => onDeleteSkill(skill.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
