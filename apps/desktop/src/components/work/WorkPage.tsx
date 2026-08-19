import type { AppState, SkillSummary } from '../../types/app-state';
import type { WorkFilter } from '../../types/navigation';
import { connectorEmoji, connectorLabel } from '../../lib/connectors';
import { formatRelativeTime, triggerLabel } from '../../lib/skill-display';
import { IconPlay, IconPause } from '../icons';
import { PageHeader } from '../layout/PageHeader';
import { IconSearch } from '../icons';

interface TaskCardProps {
  skill: SkillSummary;
  globalActive: boolean;
  onRun: () => void;
  onToggle: () => void;
}

export function TaskCard({ skill, globalActive, onRun, onToggle }: TaskCardProps) {
  const statusLabel = !globalActive ? '퇴근 중' : skill.active ? '실행 중' : '중지됨';
  const statusClass = !globalActive ? 'off-duty' : skill.active ? 'running' : 'paused';

  return (
    <div className={`task-card ${!skill.active ? 'paused' : ''}`}>
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
      <div className="task-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRun} title="지금 실행">
          지금 실행
        </button>
        <button
          type="button"
          className={`play-toggle ${skill.active ? 'active' : ''}`}
          onClick={onToggle}
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
  onWorkFilterChange: (filter: WorkFilter) => void;
  onSearchChange: (value: string) => void;
  onNewTask: () => void;
  onRunSkill: (skillId: string) => void;
  onToggleSkill: (skill: SkillSummary) => void;
}

export function WorkPage({
  state,
  skills,
  workFilter,
  search,
  onWorkFilterChange,
  onSearchChange,
  onNewTask,
  onRunSkill,
  onToggleSkill,
}: WorkPageProps) {
  return (
    <>
      <PageHeader
        title="업무"
        subtitle="맡긴 업무를 한눈에 보고 각각 켜고 끌 수 있습니다"
        action={
          <button type="button" className="btn btn-primary" onClick={onNewTask}>
            + 새 업무 지시
          </button>
        }
      />
      <div className="page-content">
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
            <option value="running">실행 중</option>
            <option value="paused">중지됨</option>
          </select>
        </div>

        {skills.length === 0 ? (
          <div className="empty-state">
            <p>아직 맡긴 업무가 없습니다</p>
            <button type="button" className="btn btn-primary" onClick={onNewTask}>
              첫 업무 지시하기
            </button>
          </div>
        ) : (
          <div className="task-list">
            {skills.map((skill) => (
              <TaskCard
                key={skill.id}
                skill={skill}
                globalActive={state?.globalActive ?? true}
                onRun={() => onRunSkill(skill.id)}
                onToggle={() => onToggleSkill(skill)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
