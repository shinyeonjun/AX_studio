import { brandFromSettingsScreen } from '../../../../ui/constants/settings';
import { AiBrandDetail } from '../ai/AiBrandDetail';
import { JevDecisionPlaneForm } from '../ai/JevDecisionPlaneForm';
import { SlackConnectionForm } from '../connectors/SlackConnectionForm';
import { GmailConnectionForm } from '../connectors/GmailConnectionForm';
import { LocalFolderConnectionForm } from '../connectors/LocalFolderConnectionForm';
import { HttpConnectionForm } from '../connectors/HttpConnectionForm';
import { WebhookConnectionForm } from '../connectors/WebhookConnectionForm';
import { RdbConnectionForm } from '../connectors/RdbConnectionForm';
import { OpenApiConnectionForm } from '../connectors/OpenApiConnectionForm';
import { McpConnectionForm } from '../connectors/McpConnectionForm';
import { SettingsHub } from '../SettingsHub';
import type { SettingsPageProps } from './contracts';

type SettingsPageContentProps = SettingsPageProps & {
  detecting: boolean;
};

export function SettingsPageContent({
  screen,
  state,
  detecting,
  detection,
  onRefresh,
  onScreenChange,
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
}: SettingsPageContentProps) {
  const detailBrand = brandFromSettingsScreen(screen);

  return (
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
          key={detailBrand}
          brand={detailBrand}
          state={state}
          detecting={detecting}
          onRefresh={onRefresh}
          detection={detection}
        />
      )}
      {screen === 'ai-jev' && <JevDecisionPlaneForm onRefresh={onRefresh} />}
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
  );
}
