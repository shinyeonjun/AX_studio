import { ipcMain } from 'electron';
import {
  DEFAULT_AI_PROVIDER,
  getAiProviderDisplay,
  isAiProviderReady,
  normalizeAiProviderConfig,
  parseGmailConnectionConfig,
  type AiProviderConfig,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { getEnvFilePath, maskSecret } from '../env-file.js';
import { getAiConfigPath, getSecretForBrand, readAiToml } from '../ai-config-file.js';
import { isGoogleOAuthConfigured } from '../google-oauth.js';

export function registerStateHandlers() {
  ipcMain.handle('ax:getState', async () => {
    const core = getCore();
    const pendingApprovals = core.store.getPendingApprovals();
    const executions = core.store.listExecutions(50);
    const skills = core.store.listSkills().map((s) => {
      const ir = core.store.getSkill(s.id);
      const connectors = ir?.steps
        ?.filter((step) => step.type === 'action')
        .map((step) => step.connector) ?? [];
      const lastExecution = executions.find((e) => e.skillId === s.id);
      return {
        ...s,
        goal: ir?.goal ?? '',
        trigger: ir?.trigger,
        connectors: [...new Set(connectors)],
        lastRunAt: lastExecution?.startedAt,
        lastStatus: lastExecution?.status,
      };
    });
    const aiProvider = normalizeAiProviderConfig(
      core.store.getSetting<AiProviderConfig | unknown>('aiProvider', DEFAULT_AI_PROVIDER),
    );
    const aiToml = await readAiToml();
    const cursorKey = await getSecretForBrand('grok');
    const gmailConn = core.store.getConnections().find((c) => c.connector === 'gmail');
    const gmailRecord = parseGmailConnectionConfig(gmailConn?.config);
    return {
      globalActive: core.store.getSetting('globalActive', true),
      aiProvider,
      aiProviderLabel: getAiProviderDisplay(aiProvider),
      aiProviderInstalled: isAiProviderReady(aiProvider),
      cursorApiKeyConfigured: Boolean(cursorKey),
      cursorApiKeyMasked: cursorKey ? maskSecret(cursorKey) : undefined,
      envFilePath: getEnvFilePath(),
      aiConfigPath: getAiConfigPath(),
      aiBrandConfigs: aiToml.providers,
      gmailOAuthConfigured: isGoogleOAuthConfigured(),
      gmailEmail: gmailConn?.connected ? gmailRecord?.account : undefined,
      gmailScopes: gmailConn?.connected ? gmailRecord?.scopes : undefined,
      gmailConnectedAt: gmailConn?.connected ? gmailRecord?.connectedAt : undefined,
      skills,
      connections: core.store.getConnections().map(({ connector, connected, config }) => ({
        connector,
        connected,
        account: parseGmailConnectionConfig(config)?.account,
        scopes: parseGmailConnectionConfig(config)?.scopes,
      })),
      pendingApprovals: pendingApprovals.length,
      approvals: pendingApprovals,
      executions,
    };
  });
}
