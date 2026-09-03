import type { AppState } from '../../../types/app-state';
import { IconTrash } from '../../icons';

interface SidebarWorkPanelProps {
  state: AppState | null;
  onOpenWork: (workflowId: string) => void;
  onToggleWorkActive: (workflowId: string, active: boolean) => void;
  onDeleteWork: (workflowId: string, name: string) => void;
}

export function SidebarWorkPanel({
  state,
  onOpenWork,
  onToggleWorkActive,
  onDeleteWork,
}: SidebarWorkPanelProps) {
  const works = state?.works ?? [];

  return (
    <div className="sidebar-panel-section">
      <h2 className="sidebar-section-title">저장된 업무</h2>
      {works.length === 0 ? (
        <p className="sidebar-empty">저장된 업무가 없습니다</p>
      ) : (
        <ul className="sidebar-work-list">
          {works.map((work) => (
            <li key={work.id} className="sidebar-work-row">
              <button type="button" className="sidebar-work-item" onClick={() => onOpenWork(work.id)}>
                <span className="sidebar-work-name">{work.name}</span>
                <span className={'sidebar-work-status ' + (work.active ? 'on' : 'off')}>
                  {work.active ? '켜짐' : '꺼짐'}
                </span>
              </button>
              <button
                type="button"
                className={'sidebar-work-toggle ' + (work.active ? 'on' : 'off')}
                onClick={() => onToggleWorkActive(work.id, !work.active)}
                title={work.active ? '스케줄 끄기' : '스케줄 켜기'}
              >
                {work.active ? '끄기' : '켜기'}
              </button>
              <button
                type="button"
                className="sidebar-session-delete"
                onClick={() => onDeleteWork(work.id, work.name)}
                aria-label={work.name + ' 업무 삭제'}
                title="업무 삭제"
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
