import {
  API_CONNECTOR_IDS,
  CONNECTOR_UI_CATALOG,
  DATA_CONNECTOR_IDS,
  MESSAGING_CONNECTOR_IDS,
  STORAGE_CONNECTOR_IDS,
} from '../../../constants/connectors';
import type { SettingsScreen } from '../../../types/navigation';
import type { AppState } from '../../../types/app-state';
import { connectionEntry } from '../../../lib/connection-display';
import { slackCapabilityStatus } from '../../../lib/slack-status';
import { ConnectionCard } from '../ConnectionCard';
import { SettingsCategory } from '../SettingsCategory';

interface SettingsConnectorSectionsProps {
  state: AppState | null;
  onOpenScreen: (screen: SettingsScreen) => void;
}

export function SettingsConnectorSections({ state, onOpenScreen }: SettingsConnectorSectionsProps) {
  return (
    <>
      <SettingsCategory title="메시징" description="메일과 Slack 알림을 업무에 연결합니다.">
        <div className="connection-hub">
          {MESSAGING_CONNECTOR_IDS.map((id) => {
            const meta = CONNECTOR_UI_CATALOG[id];
            const connected = state?.connections?.find((connection) => connection.connector === id)?.connected;
            const slackStatus = id === 'slack' ? slackCapabilityStatus(state) : undefined;
            const badge = slackStatus
              ? { label: slackStatus.badge, className: slackStatus.badgeClass }
              : connected
                ? { label: '연결됨', className: 'connected' }
                : { label: '미연결', className: '' };
            return (
              <ConnectionCard
                key={id}
                title={meta.title}
                description={meta.description}
                icon={meta.icon}
                emojiIcon={meta.emojiIcon}
                badge={badge.label}
                badgeClass={badge.className}
                onClick={() => onOpenScreen(meta.settingsScreen)}
              />
            );
          })}
        </div>
      </SettingsCategory>

      <SettingsCategory title="저장소" description="PC 폴더를 문서·파일 소스로 연결합니다.">
        <div className="connection-hub">
          {STORAGE_CONNECTOR_IDS.map((id) => {
            const meta = CONNECTOR_UI_CATALOG[id];
            const count = state?.localFolders?.length ?? 0;
            const connected = count > 0;
            return (
              <ConnectionCard
                key={id}
                title={meta.title}
                description={meta.description}
                emojiIcon={meta.emojiIcon}
                badge={connected ? `${count}개 연결` : '미연결'}
                badgeClass={connected ? 'connected' : ''}
                onClick={() => onOpenScreen(meta.settingsScreen)}
              />
            );
          })}
        </div>
      </SettingsCategory>

      <SettingsCategory title="API" description="외부 REST API를 업무에 연결합니다.">
        <div className="connection-hub">
          {API_CONNECTOR_IDS.map((id) => {
            const meta = CONNECTOR_UI_CATALOG[id];
            const entry = connectionEntry(state, id);
            const connected = Boolean(entry?.connected);
            const httpEndpointCount = id === 'http' ? entry?.endpoints?.length ?? 0 : 0;
            const description =
              id === 'http' && connected && httpEndpointCount > 1
                ? entry?.endpoints?.map((endpoint) => endpoint.label?.trim() || endpoint.baseUrl).join(' · ') ?? meta.description
                : id === 'http' && connected && entry?.baseUrl
                  ? entry.baseUrl
                  : id === 'webhook' && connected && entry?.localBaseUrl
                    ? entry.localBaseUrl
                    : meta.description;
            const badge = connected
              ? httpEndpointCount > 1
                ? `${httpEndpointCount}개 연결`
                : '연결됨'
              : '미연결';
            return (
              <ConnectionCard
                key={id}
                title={meta.title}
                description={description}
                emojiIcon={meta.emojiIcon}
                badge={badge}
                badgeClass={connected ? 'connected' : ''}
                onClick={() => onOpenScreen(meta.settingsScreen)}
              />
            );
          })}
        </div>
      </SettingsCategory>

      <SettingsCategory title="데이터" description="읽기 전용 DB를 연결합니다.">
        <div className="connection-hub">
          {DATA_CONNECTOR_IDS.map((id) => {
            const meta = CONNECTOR_UI_CATALOG[id];
            const entry = connectionEntry(state, id);
            const connected = Boolean(entry?.connected);
            const description =
              id === 'rdb' && connected && entry?.target
                ? `${entry.label?.trim() || meta.title} · ${entry.target}`
                : meta.description;
            return (
              <ConnectionCard
                key={id}
                title={meta.title}
                description={description}
                emojiIcon={meta.emojiIcon}
                badge={connected ? '연결됨' : '미연결'}
                badgeClass={connected ? 'connected' : ''}
                onClick={() => onOpenScreen(meta.settingsScreen)}
              />
            );
          })}
        </div>
      </SettingsCategory>
    </>
  );
}
