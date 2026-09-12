import {
  getAiProviderDisplay,
  getLocalFolderConnectionStatus,
  getSlackConnectionStatus,
  isAiProviderReady,
  parseGmailConnectionConfig,
} from '@ax-studio/core';
import type { AxCore } from '../../core-instance.js';
import { migrateDesktopAiProvider } from '../../ai/provider-migrate.js';
import { getEnvFilePath } from '../../env-file.js';
import { getAiConfigPath, readAiToml } from '../../ai/config-file.js';
import { isGoogleOAuthConfigured } from '../../gmail/oauth.js';
import { googleDesktopClientState } from '../../gmail/oauth-client.js';
import { getDesktopAxDataPaths } from '../../data-paths.js';
import { summarizeConnections } from '../connection-state-summary.js';

export async function buildConnectorState(core: AxCore) {
  const aiProvider = migrateDesktopAiProvider(core.store.getSetting('aiProvider', undefined));
  const aiToml = await readAiToml();
  const connections = core.store.getConnections();
  const gmailConn = connections.find((connection) => connection.connector === 'gmail');
  const gmailRecord = parseGmailConnectionConfig(gmailConn?.config);
  const slackConn = connections.find((connection) => connection.connector === 'slack');
  const slackSocketStatus = core.triggerEngine.slackSocketStatus();
  const slackStatus = getSlackConnectionStatus(
    slackConn?.config,
    Boolean(slackConn?.connected),
    slackSocketStatus.phase === 'connected' && core.triggerEngine.slackSocketActive(),
  );
  const webhookTransport = core.triggerEngine.pushTransportStatus('webhook.inbound');
  const localFolderConn = connections.find((connection) => connection.connector === 'local_folder');
  const localFolderStatus = getLocalFolderConnectionStatus(
    localFolderConn?.config,
    Boolean(localFolderConn?.connected),
  );
  const startupErrors = core.store.getSetting<Record<string, unknown>>('startup.connectorErrors', {});
  const connected = new Set(connections.filter(entry => entry.connected).map(entry => entry.connector));
  return {
    aiProvider,
    aiProviderLabel: getAiProviderDisplay(aiProvider),
    aiProviderInstalled: isAiProviderReady(aiProvider),
    envFilePath: getEnvFilePath(),
    aiConfigPath: getAiConfigPath(),
    axDataRoot: getDesktopAxDataPaths().root,
    aiBrandConfigs: aiToml.providers,
    gmailOAuthConfigured: isGoogleOAuthConfigured(),
    gmailOAuthCustom: Boolean(googleDesktopClientState().client),
    gmailOAuthError: googleDesktopClientState().error,
    connectorWarnings: Object.keys(startupErrors && typeof startupErrors === 'object' ? startupErrors : {})
      .filter(connector => !connected.has(connector))
      .map(connector => `${connector}: 저장된 연결을 복원하지 못했습니다. 설정에서 다시 연결해 주세요.`),
    gmailEmail: gmailConn?.connected ? gmailRecord?.account : undefined,
    gmailScopes: gmailConn?.connected ? gmailRecord?.scopes : undefined,
    gmailConnectedAt: gmailConn?.connected ? gmailRecord?.connectedAt : undefined,
    slackTeam: slackStatus.connected ? slackStatus.team : undefined,
    slackBotUser: slackStatus.connected ? slackStatus.botUser : undefined,
    slackHasAppToken: slackStatus.hasAppToken,
    slackSocketModeActive: slackStatus.socketModeActive,
    slackSocketStatus: slackSocketStatus.phase,
    slackConnectionMode: slackStatus.mode,
    slackLastError: slackSocketStatus.error ?? slackStatus.lastError,
    localFolders: localFolderStatus.folders,
    connections: await summarizeConnections(connections, { webhookTransport }),
  };
}
