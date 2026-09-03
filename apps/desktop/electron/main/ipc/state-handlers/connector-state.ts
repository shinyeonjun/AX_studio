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
import { getDesktopAxDataPaths } from '../../data-paths.js';
import { summarizeConnections } from '../connection-state-summary.js';

export async function buildConnectorState(core: AxCore) {
  const aiProvider = migrateDesktopAiProvider(core.store.getSetting('aiProvider', undefined));
  const aiToml = await readAiToml();
  const gmailConn = core.store.getConnections().find((connection) => connection.connector === 'gmail');
  const gmailRecord = parseGmailConnectionConfig(gmailConn?.config);
  const slackConn = core.store.getConnections().find((connection) => connection.connector === 'slack');
  const slackSocketStatus = core.triggerEngine.slackSocketStatus();
  const slackStatus = getSlackConnectionStatus(
    slackConn?.config,
    Boolean(slackConn?.connected),
    slackSocketStatus.phase === 'connected' && core.triggerEngine.slackSocketActive(),
  );
  const webhookTransport = core.triggerEngine.pushTransportStatus('webhook.inbound');
  const localFolderConn = core.store.getConnections().find((connection) => connection.connector === 'local_folder');
  const localFolderStatus = getLocalFolderConnectionStatus(
    localFolderConn?.config,
    Boolean(localFolderConn?.connected),
  );
  return {
    aiProvider,
    aiProviderLabel: getAiProviderDisplay(aiProvider),
    aiProviderInstalled: isAiProviderReady(aiProvider),
    envFilePath: getEnvFilePath(),
    aiConfigPath: getAiConfigPath(),
    axDataRoot: getDesktopAxDataPaths().root,
    aiBrandConfigs: aiToml.providers,
    gmailOAuthConfigured: isGoogleOAuthConfigured(),
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
    connections: await summarizeConnections(core.store.getConnections(), { webhookTransport }),
  };
}
