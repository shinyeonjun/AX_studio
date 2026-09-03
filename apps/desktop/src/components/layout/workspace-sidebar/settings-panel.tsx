import type { AppState } from '../../../types/app-state';
import type { SettingsScreen } from '../../../types/navigation';
import type { AiHubController } from '../../../hooks/useAiHub';
import {
  SIDEBAR_AI_BRANDS,
  SIDEBAR_CONNECTOR_LINKS,
} from './model';
import {
  SidebarAiBrandRow,
  SidebarConnectorStatus,
  SidebarSettingsLinkIcon,
  connectorStatusFor,
} from './settings-panel/components';

interface SidebarSettingsPanelProps {
  state: AppState | null;
  aiHub: AiHubController;
  aiDetecting: boolean;
  onOpenSettings: (screen: SettingsScreen) => void;
}

export function SidebarSettingsPanel({
  state,
  aiHub,
  aiDetecting,
  onOpenSettings,
}: SidebarSettingsPanelProps) {
  return (
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
          const status = connectorStatusFor(state, link);
          return (
            <button
              key={link.screen}
              type="button"
              className="sidebar-settings-link"
              onClick={() => onOpenSettings(link.screen)}
            >
              <SidebarSettingsLinkIcon link={link} />
              <span className="sidebar-settings-link-label">{link.label}</span>
              <SidebarConnectorStatus connected={status.connected} label={link.label} count={status.count} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
