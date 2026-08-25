import { useEffect } from 'react';
import type { SettingsScreen } from '../../types/navigation';
import {
  brandFromSettingsScreen,
  isSettingsScreenVisibleInUi,
  SETTINGS_TITLES,
} from '../../constants/settings';
import type { AppState } from '../../types/app-state';
import { useAiDetection } from '../../hooks/ai-settings/useAiDetection';
import { PageHeader } from '../layout/PageHeader';
import { SettingsHub } from './SettingsHub';
import { AiBrandDetail } from './ai/AiBrandDetail';
import { SlackConnectionForm } from './connectors/SlackConnectionForm';
import { GmailConnectionForm } from './connectors/GmailConnectionForm';
import { LocalFolderConnectionForm } from './connectors/LocalFolderConnectionForm';
import { HttpConnectionForm } from './connectors/HttpConnectionForm';
import { WebhookConnectionForm } from './connectors/WebhookConnectionForm';
import { RdbConnectionForm } from './connectors/RdbConnectionForm';
import { OpenApiConnectionForm } from './connectors/OpenApiConnectionForm';
import { McpConnectionForm } from './connectors/McpConnectionForm';

interface SettingsPageProps {
  screen: SettingsScreen;
  state: AppState | null;
  onScreenChange: (screen: SettingsScreen) => void;
  onRefresh: () => Promise<void>;
  onConnectSlack: (payload: { token: string; appToken?: string }) => Promise<void>;
  onDisconnectSlack: () => Promise<void>;
  onConnectGmail: () => Promise<void>;
  onDisconnectGmail: () => Promise<void>;
  onPickLocalFolder: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onAddLocalFolder: (payload: { path: string; label?: string }) => Promise<void>;
  onRemoveLocalFolder: (folderId: string) => Promise<void>;
  onConnectHttp: (payload: {
    baseUrl: string;
    label?: string;
    authType: 'none' | 'bearer' | 'apiKey' | 'basic';
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  }) => Promise<void>;
  onDisconnectHttp: () => Promise<void>;
  onConnectWebhook: (payload: {
    port: number;
    secret: string;
    label?: string;
    tunnelUrl?: string;
  }) => Promise<void>;
  onDisconnectWebhook: () => Promise<void>;
  onPickSqliteFile: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onConnectRdb: (payload: {
    type: 'mysql' | 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
    allowedSchemas?: string[];
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => Promise<void>;
  onDisconnectRdb: () => Promise<void>;
  onConnectOpenApi: (payload: {
    specId: string;
    label?: string;
    specUrl?: string;
    specJson?: string;
  }) => Promise<void>;
  onDisconnectOpenApi: () => Promise<void>;
  onConnectMcp: (payload: { serverId: string; label?: string; toolsJson: string }) => Promise<void>;
  onDisconnectMcp: () => Promise<void>;
}

function settingsSubtitle(screen: SettingsScreen): string {
  if (screen === 'hub') return '카테고리별로 연결할 항목을 선택하세요';
  if (screen.startsWith('ai-')) return 'CLI 또는 API를 선택해 적용하세요';
  return '인증 정보를 입력하고 연결합니다';
}

function settingsBackTarget(screen: SettingsScreen): SettingsScreen | null {
  return screen === 'hub' ? null : 'hub';
}

export function SettingsPage({
  screen,
  state,
  onScreenChange,
  onRefresh,
  onConnectSlack,
  onDisconnectSlack,
  onConnectGmail,
  onDisconnectGmail,
  onPickLocalFolder,
  onAddLocalFolder,
  onRemoveLocalFolder,
  onConnectHttp,
  onDisconnectHttp,
  onConnectWebhook,
  onDisconnectWebhook,
  onPickSqliteFile,
  onConnectRdb,
  onDisconnectRdb,
  onConnectOpenApi,
  onDisconnectOpenApi,
  onConnectMcp,
  onDisconnectMcp,
}: SettingsPageProps) {
  const detection = useAiDetection();
  const { detecting, setDetecting, refreshDetection } = detection;
  const detailBrand = brandFromSettingsScreen(screen);
  const backTarget = settingsBackTarget(screen);

  useEffect(() => {
    if (!isSettingsScreenVisibleInUi(screen)) {
      onScreenChange('hub');
    }
  }, [screen, onScreenChange]);

  useEffect(() => {
    if (screen !== 'hub') return;
    let cancelled = false;
    (async () => {
      setDetecting(true);
      try {
        await refreshDetection();
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hub mount only
  }, [screen]);

  useEffect(() => {
    if (!detailBrand) return;
    let cancelled = false;
    (async () => {
      setDetecting(true);
      try {
        await refreshDetection();
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- brand detail mount
  }, [detailBrand]);

  return (
    <>
      <PageHeader
        title={SETTINGS_TITLES[screen]}
        subtitle={settingsSubtitle(screen)}
        backLabel={backTarget ? '← 연결 목록' : undefined}
        onBack={backTarget ? () => onScreenChange(backTarget) : undefined}
      />
      <div className="page-content">
        {screen === 'hub' && (
          <SettingsHub
            state={state}
            detecting={detecting}
            detection={detection}
            onRefresh={onRefresh}
            onOpenScreen={onScreenChange}
          />
        )}
        {detailBrand && (
          <AiBrandDetail
            brand={detailBrand}
            state={state}
            detecting={detecting}
            onRefresh={onRefresh}
            detection={detection}
          />
        )}
        {screen === 'slack' && (
          <SlackConnectionForm state={state} onConnect={onConnectSlack} onDisconnect={onDisconnectSlack} />
        )}
        {screen === 'gmail' && (
          <GmailConnectionForm
            state={state}
            onConnect={onConnectGmail}
            onDisconnect={onDisconnectGmail}
          />
        )}
        {screen === 'local-folder' && (
          <LocalFolderConnectionForm
            state={state}
            onPickFolder={onPickLocalFolder}
            onAddFolder={onAddLocalFolder}
            onRemoveFolder={onRemoveLocalFolder}
          />
        )}
        {screen === 'http' && (
          <HttpConnectionForm state={state} onConnect={onConnectHttp} onDisconnect={onDisconnectHttp} />
        )}
        {screen === 'webhook' && (
          <WebhookConnectionForm
            state={state}
            onConnect={onConnectWebhook}
            onDisconnect={onDisconnectWebhook}
          />
        )}
        {screen === 'rdb' && (
          <RdbConnectionForm
            state={state}
            onPickSqliteFile={onPickSqliteFile}
            onConnect={onConnectRdb}
            onDisconnect={onDisconnectRdb}
          />
        )}
        {screen === 'openapi' && (
          <OpenApiConnectionForm state={state} onConnect={onConnectOpenApi} onDisconnect={onDisconnectOpenApi} />
        )}
        {screen === 'mcp' && (
          <McpConnectionForm state={state} onConnect={onConnectMcp} onDisconnect={onDisconnectMcp} />
        )}
      </div>
    </>
  );
}
