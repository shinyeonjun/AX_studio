import type { Tab } from '../../types/navigation';
import {
  IconBriefcase,
  IconCheck,
  IconActivity,
  IconSettings,
} from '../icons';

interface SidebarProps {
  tab: Tab;
  pendingApprovals: number;
  onTabChange: (tab: Tab) => void;
}

export function Sidebar({ tab, pendingApprovals, onTabChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">AX</div>
        <span className="brand-text">AX Studio</span>
      </div>

      <nav className="nav">
        <button className={`nav-item ${tab === 'work' ? 'active' : ''}`} onClick={() => onTabChange('work')}>
          <IconBriefcase />
          업무
        </button>
        <button className={`nav-item ${tab === 'approval' ? 'active' : ''}`} onClick={() => onTabChange('approval')}>
          <IconCheck />
          승인
          {pendingApprovals > 0 && <span className="nav-badge">{pendingApprovals}</span>}
        </button>
        <button className={`nav-item ${tab === 'activity' ? 'active' : ''}`} onClick={() => onTabChange('activity')}>
          <IconActivity />
          활동
        </button>
        <button className={`nav-item ${tab === 'settings' ? 'active' : ''}`} onClick={() => onTabChange('settings')}>
          <IconSettings />
          설정
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="user-card">
          <div className="user-avatar">J</div>
          <div>
            <div className="user-name">Local User</div>
            <div className="user-mode">Local Mode</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
