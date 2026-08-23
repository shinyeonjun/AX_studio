import type { AppState } from '../../types/app-state';
import type { SettingsScreen, SidebarTab } from '../../types/navigation';
import type { ChatSessionSummary } from '../../hooks/useChatSessions';
import type { AiHubController } from '../../hooks/useAiHub';
import { AI_PROVIDER_UI_CATALOG } from '../../constants/ai-providers';
import { CONNECTOR_UI_CATALOG } from '../../constants/connectors';
import { axStudioLogo } from '../../constants/brand';
import { settingsScreenForBrand } from '../../constants/settings';
import type { AiBrand } from '../../types/ai-provider';
import { IconActivity, IconBriefcase, IconCheck, IconSettings, IconPlus, IconTrash } from '../icons';
import { ThemeToggle } from './ThemeToggle';

const SIDEBAR_AI_BRANDS: AiBrand[] = ['claude', 'gpt'];

interface SidebarSettingsLink {
  screen: SettingsScreen;
  label: string;
  icon?: string;
  emojiIcon?: string;
  useSettingsIcon?: boolean;
}

const SIDEBAR_CONNECTOR_LINKS: SidebarSettingsLink[] = [
  { screen: 'slack', label: 'Slack', icon: CONNECTOR_UI_CATALOG.slack.icon },
  { screen: 'gmail', label: 'Gmail', icon: CONNECTOR_UI_CATALOG.gmail.icon },
  {
    screen: 'local-folder',
    label: '로컬 폴더',
    icon: CONNECTOR_UI_CATALOG.local_folder.icon,
    emojiIcon: CONNECTOR_UI_CATALOG.local_folder.emoji,
  },
];

function isConnectorConnected(state: AppState | null, screen: SettingsScreen): boolean {
  if (!state) return false;
  if (screen === 'slack') {
    return state.connections?.find((connection) => connection.connector === 'slack')?.connected ?? false;
  }
  if (screen === 'gmail') {
    return state.connections?.find((connection) => connection.connector === 'gmail')?.connected ?? false;
  }
  if (screen === 'local-folder') {
    return (state.localFolders?.length ?? 0) > 0;
  }
  return false;
}

function SidebarConnectorStatus({
  connected,
  label,
  count,
}: {
  connected: boolean;
  label: string;
  count?: number;
}) {
  const countLabel = count && count > 0 ? `${count}개 연결` : undefined;
  const statusLabel = connected ? `${label} 연결됨` : `${label} 미연결`;
  return (
    <div className="sidebar-connector-meta">
      {countLabel && <span className="sidebar-connector-count">{count}개</span>}
      <span
        className={`sidebar-connector-status${connected ? ' is-connected' : ''}`}
        role="img"
        aria-label={countLabel ? `${statusLabel}, ${countLabel}` : statusLabel}
        title={countLabel ? `${statusLabel} · ${countLabel}` : connected ? '연결됨' : '미연결'}
      />
    </div>
  );
}

function SidebarSettingsLinkIcon({ link }: { link: SidebarSettingsLink }) {
  if (link.useSettingsIcon) {
    return (
      <span className="sidebar-settings-link-icon sidebar-settings-link-icon--svg" aria-hidden>
        <IconSettings />
      </span>
    );
  }
  if (link.icon) {
    return <img src={link.icon} alt="" className="sidebar-settings-link-icon" />;
  }
  return (
    <span className="sidebar-settings-link-icon sidebar-settings-link-icon--emoji" aria-hidden>
      {link.emojiIcon ?? '⚙️'}
    </span>
  );
}

function SidebarAiBrandRow({
  brand,
  hub,
  onOpenSettings,
}: {
  brand: AiBrand;
  hub: AiHubController;
  onOpenSettings: (screen: SettingsScreen) => void;
}) {
  const meta = AI_PROVIDER_UI_CATALOG[brand];
  const status = hub.brandStatus(brand);
  const isActive = hub.activeBrand === brand;
  const selectable = status === 'ready';

  const handleSelect = () => {
    if (hub.modeSaving || isActive) return;
    if (selectable) {
      void hub.selectBrand(brand);
      return;
    }
    onOpenSettings(settingsScreenForBrand(brand));
  };

  return (
    <div className={`sidebar-ai-brand-row${isActive ? ' is-active' : ''}`}>
      <button
        type="button"
        className="sidebar-settings-link sidebar-ai-brand-select"
        onClick={handleSelect}
        disabled={hub.modeSaving}
        aria-pressed={isActive}
        aria-label={isActive ? `${meta.title} 사용 중` : selectable ? `${meta.title} 선택` : `${meta.title} 설정 열기`}
      >
        <span className={`sidebar-ai-check${isActive ? ' selected' : ''}`} aria-hidden>
          {isActive && <span className="sidebar-ai-check-mark" />}
        </span>
        <img src={meta.icon} alt="" className="sidebar-settings-link-icon" />
        <span className="sidebar-settings-link-label">{meta.title}</span>
        {!isActive && status === 'off' && <span className="sidebar-ai-off-badge">미연결</span>}
      </button>
      <button
        type="button"
        className="sidebar-ai-settings-btn"
        onClick={() => onOpenSettings(settingsScreenForBrand(brand))}
        aria-label={`${meta.title} 설정`}
        title={`${meta.title} 설정`}
      >
        <IconSettings />
      </button>
    </div>
  );
}

interface WorkspaceSidebarProps {
  tab: SidebarTab;
  sessions: ChatSessionSummary[];
  activeSessionId?: string;
  pendingApprovals: number;
  state: AppState | null;
  aiHub: AiHubController;
  aiDetecting: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  onTabChange: (tab: SidebarTab) => void;
  onNewChat: () => void;
  onSelectSession: (session: ChatSessionSummary) => void;
  onDeleteSession: (session: ChatSessionSummary) => void;
  onOpenWork: (workflowId: string) => void;
  onToggleWorkActive: (workflowId: string, active: boolean) => void;
  onDeleteWork: (workflowId: string, name: string) => void;
  onOpenSettings: (screen: SettingsScreen) => void;
}

export function WorkspaceSidebar({
  tab,
  sessions,
  activeSessionId,
  pendingApprovals,
  state,
  aiHub,
  aiDetecting,
  isDark,
  onToggleTheme,
  onTabChange,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onOpenWork,
  onToggleWorkActive,
  onDeleteWork,
  onOpenSettings,
}: WorkspaceSidebarProps) {
  const works = state?.works ?? [];

  return (
    <aside className="workspace-sidebar">
      <div className="workspace-sidebar-brand">
        <img src={axStudioLogo} alt="" className="brand-icon" />
        <span className="brand-text">AX Studio</span>
        <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
      </div>

      <nav className="workspace-sidebar-tabs" aria-label="주요 메뉴">
        <button
          type="button"
          aria-current={tab === 'work' ? 'page' : undefined}
          className={`workspace-sidebar-tab ${tab === 'work' ? 'active' : ''}`}
          onClick={() => onTabChange('work')}
        >
          <IconBriefcase />
          업무
        </button>
        <button
          type="button"
          aria-current={tab === 'approval' ? 'page' : undefined}
          className={`workspace-sidebar-tab ${tab === 'approval' ? 'active' : ''}`}
          onClick={() => onTabChange('approval')}
        >
          <IconCheck />
          승인
          {pendingApprovals > 0 && <span className="nav-badge">{pendingApprovals}</span>}
        </button>
        <button
          type="button"
          aria-current={tab === 'activity' ? 'page' : undefined}
          className={`workspace-sidebar-tab ${tab === 'activity' ? 'active' : ''}`}
          onClick={() => onTabChange('activity')}
        >
          <IconActivity />
          활동
        </button>
        <button
          type="button"
          aria-current={tab === 'settings' ? 'page' : undefined}
          className={`workspace-sidebar-tab ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
        >
          <IconSettings />
          설정
        </button>
      </nav>

      <div className="workspace-sidebar-panel scrollbar-overlay">
        {tab === 'work' && (
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
                      <span className={`sidebar-work-status ${work.active ? 'on' : 'off'}`}>
                        {work.active ? '실행 중' : '중지'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`sidebar-work-toggle ${work.active ? 'on' : 'off'}`}
                      onClick={() => onToggleWorkActive(work.id, !work.active)}
                      title={work.active ? '업무 중지' : '업무 활성화'}
                    >
                      {work.active ? '중지' : '활성화'}
                    </button>
                    <button
                      type="button"
                      className="sidebar-session-delete"
                      onClick={() => onDeleteWork(work.id, work.name)}
                      aria-label={`${work.name} 업무 삭제`}
                      title="업무 삭제"
                    >
                      <IconTrash />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'approval' && (
          <div className="sidebar-panel-section">
            <p className="sidebar-empty">
              {pendingApprovals > 0
                ? `대기 ${pendingApprovals}건 — 중앙 패널에서 승인·거절하세요.`
                : '대기 중인 승인이 없습니다.'}
            </p>
          </div>
        )}

        {tab === 'activity' && (
          <div className="sidebar-panel-section">
            <p className="sidebar-empty">실행 기록은 중앙 패널에서 확인합니다.</p>
          </div>
        )}

        {tab === 'settings' && (
          <div className="sidebar-panel-section sidebar-settings-links">
            <div className="sidebar-settings-group">
              <button
                type="button"
                className="sidebar-settings-link"
                onClick={() => onOpenSettings('hub')}
              >
                <SidebarSettingsLinkIcon
                  link={{ screen: 'hub', label: '설정 홈', useSettingsIcon: true }}
                />
                <span className="sidebar-settings-link-label">설정 홈</span>
              </button>
            </div>

            <div className="sidebar-settings-group">
              <hr className="sidebar-settings-divider" />
              {aiDetecting && <p className="sidebar-ai-hub-note">AI 연결 확인 중…</p>}
              {aiHub.hubMessage && <p className="sidebar-ai-hub-note">{aiHub.hubMessage}</p>}
              {SIDEBAR_AI_BRANDS.map((brand) => (
                <SidebarAiBrandRow
                  key={brand}
                  brand={brand}
                  hub={aiHub}
                  onOpenSettings={onOpenSettings}
                />
              ))}
            </div>

            <div className="sidebar-settings-group">
              <hr className="sidebar-settings-divider" />
              {SIDEBAR_CONNECTOR_LINKS.map((link) => {
                const connected = isConnectorConnected(state, link.screen);
                const localFolderCount =
                  link.screen === 'local-folder' ? state?.localFolders?.length ?? 0 : undefined;
                return (
                  <button
                    key={link.screen}
                    type="button"
                    className="sidebar-settings-link"
                    onClick={() => onOpenSettings(link.screen)}
                  >
                    <SidebarSettingsLinkIcon link={link} />
                    <span className="sidebar-settings-link-label">{link.label}</span>
                    <SidebarConnectorStatus
                      connected={connected}
                      label={link.label}
                      count={localFolderCount}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="workspace-sidebar-sessions">
        <h2 className="sidebar-section-title">최근 대화</h2>
        <button type="button" className="sidebar-new-chat" onClick={onNewChat}>
          <IconPlus />
          새 대화
        </button>
        <ul className="sidebar-session-list scrollbar-overlay">
          {sessions.map((session) => (
            <li key={session.id} className="sidebar-session-row">
              <button
                type="button"
                className={`sidebar-session-item ${activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => onSelectSession(session)}
              >
                <span className="sidebar-session-title">{session.title}</span>
              </button>
              <button
                type="button"
                className="sidebar-session-delete"
                onClick={() => onDeleteSession(session)}
                aria-label={`${session.title} 대화 삭제`}
                title="대화 삭제"
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
