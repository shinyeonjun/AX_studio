import { BrowserWindow, ipcMain } from 'electron';
import {
  startInterview,
  applyAnswer,
  summarizeSkill,
  explainExecution,
  proposeSkillRevision,
  SlackConnector,
  createModelProvider,
  DEFAULT_AI_PROVIDER,
  detectAiCliProviders,
  getAiProviderDisplay,
  isAiProviderReady,
  normalizeAiProviderConfig,
  parseGmailConnectionConfig,
  type AiProviderConfig,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { getEnvFilePath, maskSecret, readEnvFile, setEnvFileValue } from '../env-file.js';
import { verifyCursorApiKey } from '../cursor-api.js';
import {
  getAiConfigPath,
  getSecretForBrand,
  getSecretByEnvKey,
  isAiEnvKey,
  envKeyForBrand,
  readAiToml,
  saveActiveAi,
  setBrandSecret,
  writeAiToml,
  type AiBrandId,
} from '../ai-config-file.js';
import { verifyAiApiKey } from '../ai-api-verify.js';
import { testAiCli } from '../ai-cli-test.js';
import { isGoogleOAuthConfigured } from '../google-oauth.js';
import { connectGmailOAuth, disconnectGmailOAuth } from '../gmail-connection.js';

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

export function registerInterviewHandlers() {
  ipcMain.handle('ax:startInterview', async (_e, instruction: string) => startInterview(instruction));
  ipcMain.handle('ax:applyAnswer', async (_e, state, answer: string) => applyAnswer(state, answer));
  ipcMain.handle('ax:summarize', async (_e, ir) => summarizeSkill(ir));
  ipcMain.handle('ax:explain', async (_e, question: string) => explainExecution(getCore().store, question));
  ipcMain.handle('ax:proposeRevision', async (_e, skillId: string, instruction: string) => {
    const ir = getCore().store.getSkill(skillId);
    return proposeSkillRevision(ir ?? {}, instruction);
  });
}

export function registerRuntimeHandlers() {
  ipcMain.handle('ax:saveSkill', async (_e, ir) => getCore().store.saveSkill(ir));
  ipcMain.handle('ax:runSkill', async (_e, skillId: string) => {
    const core = getCore();
    const ir = core.store.getSkill(skillId);
    if (!ir) throw new Error('Skill not found');
    return core.runtime.executeSkill(ir, { triggerType: 'manual' });
  });
  ipcMain.handle('ax:runEphemeral', async (_e, ir) =>
    getCore().runtime.executeSkill(ir, { ephemeral: true, triggerType: 'manual' }),
  );
  ipcMain.handle('ax:approve', async (_e, approvalId: string) => getCore().runtime.continueAfterApproval(approvalId));
  ipcMain.handle('ax:reject', async (_e, approvalId: string) => {
    getCore().store.resolveApproval(approvalId, false);
    return { ok: true };
  });
  ipcMain.handle('ax:setGlobalActive', async (_e, active: boolean) => {
    const core = getCore();
    core.store.setSetting('globalActive', active);
    core.runtime.setGlobalActive(active);
    return { ok: true };
  });
  ipcMain.handle('ax:setSkillActive', async (_e, skillId: string, active: boolean) => {
    const core = getCore();
    core.store.setSkillActive(skillId, active);
    core.runtime.setSkillActive(skillId, active);
    return { ok: true };
  });
}

export function registerAiHandlers() {
  ipcMain.handle('ax:detectAiCli', async () => detectAiCliProviders());
  ipcMain.handle('ax:getAiConfig', async () => {
    const config = await readAiToml();
    return {
      path: getAiConfigPath(),
      active: config.active,
      providers: config.providers,
      secrets: Object.fromEntries(
        await Promise.all(
          (['claude', 'gpt', 'grok'] as AiBrandId[]).map(async (brand) => {
            const val = await getSecretForBrand(brand);
            return [brand, { configured: Boolean(val), masked: val ? maskSecret(val) : undefined }];
          }),
        ),
      ),
    };
  });
  ipcMain.handle('ax:setAiProvider', async (_e, raw: unknown) => {
    const core = getCore();
    const config = normalizeAiProviderConfig(raw);
    core.store.setSetting('aiProvider', config);
    const model = createModelProvider(config);
    core.runtime.setModel(model);
    core.model = model;
    if (config.brand && config.mode && config.model) {
      await saveActiveAi(config.brand as AiBrandId, config.mode, config.model);
    }
    return { ok: true, label: getAiProviderDisplay(config) };
  });
  ipcMain.handle('ax:saveAiBrandConfig', async (_e, brand: AiBrandId, prefs: { mode?: string; model?: string; apiKey?: string }) => {
    if (prefs.apiKey?.trim()) {
      await setBrandSecret(brand, prefs.apiKey.trim());
    }
    const config = await readAiToml();
    config.providers[brand] = {
      ...config.providers[brand],
      mode: prefs.mode as 'cli' | 'api' | undefined,
      model: prefs.model,
    };
    await writeAiToml(config);
    return { ok: true };
  });
  ipcMain.handle('ax:testAiCli', async (_e, brand: AiBrandId) => testAiCli(brand));
  ipcMain.handle('ax:testAiApi', async (_e, brand: AiBrandId, apiKey?: string) => {
    const testKey = (apiKey?.trim() || (await getSecretForBrand(brand)) || '').trim();
    if (!testKey) throw new Error('API 키가 없습니다.');
    const result = await verifyAiApiKey(brand as 'claude' | 'gpt' | 'grok', testKey);
    if (apiKey?.trim()) {
      await setBrandSecret(brand, testKey);
    }
    return { ok: true, label: result.label, masked: maskSecret(testKey), saved: Boolean(apiKey?.trim()) };
  });
  ipcMain.handle('ax:setEnvSecret', async (_e, key: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('값을 입력하세요.');
    if (isAiEnvKey(key)) {
      const brand = (['claude', 'gpt', 'grok', 'ollama'] as AiBrandId[]).find(
        (item) => envKeyForBrand(item) === key,
      );
      if (brand) await setBrandSecret(brand, trimmed);
    } else {
      await setEnvFileValue(key, trimmed);
      process.env[key] = trimmed;
    }
    return { ok: true, masked: maskSecret(trimmed) };
  });
  ipcMain.handle('ax:getEnvSecretStatus', async (_e, key: string) => {
    const fromStore = isAiEnvKey(key) ? await getSecretByEnvKey(key) : '';
    const env = await readEnvFile();
    const val = (fromStore || env[key] || process.env[key] || '').trim();
    return {
      configured: Boolean(val),
      masked: val ? maskSecret(val) : undefined,
      envFilePath: getEnvFilePath(),
    };
  });
  ipcMain.handle('ax:setCursorApiKey', async (_e, key: string) => {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('API 키를 입력하세요.');
    await setBrandSecret('grok', trimmed);
    return { ok: true, masked: maskSecret(trimmed) };
  });
  ipcMain.handle('ax:testCursorApiKey', async (_e, key?: string) => {
    const testKey = (key?.trim() || (await getSecretForBrand('grok'))).trim();
    if (!testKey) throw new Error('API 키가 없습니다.');
    const info = await verifyCursorApiKey(testKey);
    return {
      ok: true,
      email: info.email,
      apiKeyName: info.apiKeyName,
      masked: maskSecret(testKey),
    };
  });
}

export function registerConnectionHandlers() {
  ipcMain.handle('ax:connectSlack', async (_e, token: string) => {
    const core = getCore();
    core.store.setConnection('slack', true, { token });
    core.runtime.connectors.slack = new SlackConnector(token);
    return { ok: true };
  });
  ipcMain.handle('ax:connectGmailOAuth', async () => {
    const core = getCore();
    return connectGmailOAuth(core.store, core.runtime);
  });
  ipcMain.handle('ax:disconnectGmailOAuth', async () => {
    const core = getCore();
    return disconnectGmailOAuth(core.store, core.runtime);
  });
}

export function registerUtilityHandlers() {
  ipcMain.handle('ax:printPdf', async (_e, html: string) => {
    const win = new BrowserWindow({ show: false });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({});
    win.destroy();
    return pdf;
  });
}

export function registerIpcHandlers() {
  registerStateHandlers();
  registerInterviewHandlers();
  registerRuntimeHandlers();
  registerAiHandlers();
  registerConnectionHandlers();
  registerUtilityHandlers();
}
