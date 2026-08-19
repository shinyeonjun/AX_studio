import type { WorkSummary } from '../../types/app-state';
import type { WorkFilter } from '../../types/navigation';
import { connectorEmoji, connectorLabel } from '../../constants/connectors';
import { formatRelativeTime, isEphemeralWork, triggerLabel } from '../../lib/work-display';
import { IconPlay, IconPause } from '../icons';

interface TaskCardProps {
  work: WorkSummary;
  globalActive: boolean;
  onOpen: () => void;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

export function TaskCard({ work, globalActive, onOpen, onRun, onToggle, onDelete }: TaskCardProps) {
  const statusLabel = !globalActive ? '퇴근 중' : work.active ? '실행 중' : '중지됨';
  const statusClass = !globalActive ? 'off-duty' : work.active ? 'running' : 'paused';

  return (
    <div className={`task-card ${!work.active ? 'paused' : ''}`}>
      <button type="button" className="task-card-main" onClick={onOpen}>
        <div className="task-icon-wrap">{connectorEmoji(work.connectors?.[0] ?? 'gmail')}</div>
        <div className="task-body">
          <h3 className="task-title">{work.name}</h3>
          <p className="task-desc">{work.goal || '설명 없음'}</p>
          <div className="task-meta">
            <div className="connector-badges">
              {(work.connectors ?? []).map((c) => (
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
              {triggerLabel(work.trigger)} · 최근 {formatRelativeTime(work.lastRunAt)}
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
          className={`play-toggle ${work.active ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={work.active ? '업무 중지' : '업무 활성화'}
          aria-label={work.active ? '중지' : '활성화'}
        >
          {work.active ? <IconPause /> : <IconPlay />}
        </button>
      </div>
    </div>
  );
}

interface WorkSectionProps {
  title: string;
  subtitle?: string;
  works: WorkSummary[];
  globalActive: boolean;
  onOpenWork: (workflowId: string) => void;
  onRunWorkflow: (workflowId: string) => void;
  onToggleWork: (work: WorkSummary) => void;
  onDeleteWork: (workflowId: string) => void;
}

export function WorkSection({
  title,
  subtitle,
  works,
  globalActive,
  onOpenWork,
  onRunWorkflow,
  onToggleWork,
  onDeleteWork,
}: WorkSectionProps) {
  if (works.length === 0) return null;

  return (
    <section className="work-section">
      <header className="work-section-header">
        <h2 className="work-section-title">{title}</h2>
        {subtitle ? <p className="work-section-subtitle">{subtitle}</p> : null}
      </header>
      <div className="task-list">
        {works.map((work) => (
          <TaskCard
            key={work.id}
            work={work}
            globalActive={globalActive}
            onOpen={() => onOpenWork(work.id)}
            onRun={() => onRunWorkflow(work.id)}
            onToggle={() => onToggleWork(work)}
            onDelete={() => onDeleteWork(work.id)}
          />
        ))}
      </div>
    </section>
  );
}

interface WorkListProps {
  works: WorkSummary[];
  workFilter: WorkFilter;
  globalActive: boolean;
  onOpenWork: (workflowId: string) => void;
  onRunWorkflow: (workflowId: string) => void;
  onToggleWork: (work: WorkSummary) => void;
  onDeleteWork: (workflowId: string) => void;
}

export function WorkList({
  works,
  workFilter,
  globalActive,
  onOpenWork,
  onRunWorkflow,
  onToggleWork,
  onDeleteWork,
}: WorkListProps) {
  if (workFilter === 'all') {
    return (
      <div className="work-sections">
        <WorkSection
          title="업무"
          subtitle="반복·트리거로 맡긴 업무"
          works={works.filter((work) => !isEphemeralWork(work.trigger))}
          globalActive={globalActive}
          onOpenWork={onOpenWork}
          onRunWorkflow={onRunWorkflow}
          onToggleWork={onToggleWork}
          onDeleteWork={onDeleteWork}
        />
        <WorkSection
          title="일회용"
          subtitle="한 번 실행한 업무 · 대화 이어하기"
          works={works.filter((work) => isEphemeralWork(work.trigger))}
          globalActive={globalActive}
          onOpenWork={onOpenWork}
          onRunWorkflow={onRunWorkflow}
          onToggleWork={onToggleWork}
          onDeleteWork={onDeleteWork}
        />
      </div>
    );
  }

  return (
    <div className="task-list">
      {works.map((work) => (
        <TaskCard
          key={work.id}
          work={work}
          globalActive={globalActive}
          onOpen={() => onOpenWork(work.id)}
          onRun={() => onRunWorkflow(work.id)}
          onToggle={() => onToggleWork(work)}
          onDelete={() => onDeleteWork(work.id)}
        />
      ))}
    </div>
  );
}
