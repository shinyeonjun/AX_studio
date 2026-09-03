import type { SidebarTab } from '../../../types/navigation';
import { IconActivity, IconBriefcase, IconCheck, IconSettings } from '../../icons';

interface SidebarNavigationProps {
  tab: SidebarTab;
  pendingApprovals: number;
  onTabChange: (tab: SidebarTab) => void;
}

export function SidebarNavigation({
  tab,
  pendingApprovals,
  onTabChange,
}: SidebarNavigationProps) {
  return (
    <nav className="workspace-sidebar-tabs" aria-label="주요 메뉴">
      <button
        type="button"
        aria-current={tab === 'work' ? 'page' : undefined}
        className={'workspace-sidebar-tab ' + (tab === 'work' ? 'active' : '')}
        onClick={() => onTabChange('work')}
      >
        <IconBriefcase />
        업무
      </button>
      <button
        type="button"
        aria-current={tab === 'approval' ? 'page' : undefined}
        className={'workspace-sidebar-tab ' + (tab === 'approval' ? 'active' : '')}
        onClick={() => onTabChange('approval')}
      >
        <IconCheck />
        승인
        {pendingApprovals > 0 && <span className="nav-badge">{pendingApprovals}</span>}
      </button>
      <button
        type="button"
        aria-current={tab === 'activity' ? 'page' : undefined}
        className={'workspace-sidebar-tab ' + (tab === 'activity' ? 'active' : '')}
        onClick={() => onTabChange('activity')}
      >
        <IconActivity />
        활동
      </button>
      <button
        type="button"
        aria-current={tab === 'settings' ? 'page' : undefined}
        className={'workspace-sidebar-tab ' + (tab === 'settings' ? 'active' : '')}
        onClick={() => onTabChange('settings')}
      >
        <IconSettings />
        설정
      </button>
    </nav>
  );
}
