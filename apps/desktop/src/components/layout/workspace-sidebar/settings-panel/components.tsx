import type { AppState } from '../../../../types/app-state';
import type { SettingsScreen } from '../../../../types/navigation';
import type { AiHubController } from '../../../../hooks/useAiHub';
import { AI_PROVIDER_UI_CATALOG } from '../../../../constants/ai-providers';
import { settingsScreenForBrand } from '../../../../constants/settings';
import type { AiBrand } from '../../../../types/ai-provider';
import { IconSettings } from '../../../icons';
import {
  connectorCount,
  isConnectorConnected,
  type SidebarSettingsLink,
} from '../model';

export function SidebarConnectorStatus({
  connected,
  label,
  count,
}: {
  connected: boolean;
  label: string;
  count?: number;
}) {
  const countLabel = count && count > 0 ? count + '개 연결' : undefined;
  const statusLabel = connected ? label + ' 연결됨' : label + ' 미연결';
  return (
    <div className="sidebar-connector-meta">
      {countLabel && <span className="sidebar-connector-count">{count}개</span>}
      <span
        className={'sidebar-connector-status' + (connected ? ' is-connected' : '')}
        role="img"
        aria-label={countLabel ? statusLabel + ', ' + countLabel : statusLabel}
        title={countLabel ? statusLabel + ' · ' + countLabel : connected ? '연결됨' : '미연결'}
      />
    </div>
  );
}

export function SidebarSettingsLinkIcon({ link }: { link: SidebarSettingsLink }) {
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

export function SidebarAiBrandRow({
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
    <div className={'sidebar-ai-brand-row' + (isActive ? ' is-active' : '')}>
      <button
        type="button"
        className="sidebar-settings-link sidebar-ai-brand-select"
        onClick={handleSelect}
        disabled={hub.modeSaving}
        aria-pressed={isActive}
        aria-label={isActive ? meta.title + ' 사용 중' : selectable ? meta.title + ' 선택' : meta.title + ' 설정 열기'}
      >
        <span className={'sidebar-ai-check' + (isActive ? ' selected' : '')} aria-hidden>
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
        aria-label={meta.title + ' 설정'}
        title={meta.title + ' 설정'}
      >
        <IconSettings />
      </button>
    </div>
  );
}

export function connectorStatusFor(state: AppState | null, link: SidebarSettingsLink) {
  return {
    connected: isConnectorConnected(state, link.screen),
    count: connectorCount(state, link.screen),
  };
}
