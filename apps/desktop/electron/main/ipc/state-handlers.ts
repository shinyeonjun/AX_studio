import { ipcMain } from 'electron';
import {
  formatApprovalTitle,
  getAiProviderDisplay,
  isAiProviderReady,
  getSlackConnectionStatus,
  getLocalFolderConnectionStatus,
  parseGmailConnectionConfig,
  parseLocalFolderConnectionConfig,
  parseWorkflowIR,
} from '@ax-studio/core';
import { migrateDesktopAiProvider } from '../ai/provider-migrate.js';
import { getCore } from '../core-instance.js';
import { getEnvFilePath } from '../env-file.js';
import { getAiConfigPath, readAiToml } from '../ai/config-file.js';
import { isGoogleOAuthConfigured } from '../gmail/oauth.js';
import { getDesktopAxDataPaths } from '../data-paths.js';

export function registerStateHandlers() {
  ipcMain.handle('ax:getState', async () => {
    const core = getCore();
    const pendingApprovals = core.store.getPendingApprovals().map((approval) => {
      const execution = core.store.getExecution(approval.executionId);
      let ir = null;
      let snapshotError: string | undefined;
      if (!execution?.irJson) {
        snapshotError = '승인 재개에 필요한 실행 스냅샷이 없습니다.';
      } else {
        try {
          ir = parseWorkflowIR(JSON.parse(execution.irJson));
        } catch (error) {
          snapshotError = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        ...approval,
        ...(snapshotError ? { errorCode: 'invalid_execution_snapshot', errorMessage: snapshotError } : {}),
        title: formatApprovalTitle({
          workName: ir?.name,
          reason: approval.reason,
          actionIds: approval.actionIds,
          ir,
        }),
      };
    });
    const executions = core.store.listExecutions(50).map((execution) => {
      let errorMessage: string | undefined;
      if (execution.status === 'failed' && execution.logJson) {
        try {
          const log = JSON.parse(execution.logJson) as Array<{ level?: string; message?: string }>;
          errorMessage = log.filter((entry) => entry.level === 'error').at(-1)?.message;
        } catch (error) {
          errorMessage = `실행 로그가 손상되었습니다: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      return {
        id: execution.id,
        workflowId: execution.workflowId,
        status: execution.status,
        startedAt: execution.startedAt,
        errorCode: execution.errorCode,
        errorMessage,
        triggerType: execution.triggerType,
      };
    });
    const works = core.store.listWorkflows().map((s) => {
      const ir = core.store.getWorkflow(s.id);
      const connectors = ir?.steps
        ?.filter((step) => step.type === 'action')
        .map((step) => step.connector) ?? [];
      const lastExecution = executions.find((e) => e.workflowId === s.id);
      return {
        ...s,
        goal: ir?.goal ?? '',
        trigger: ir?.trigger,
        connectors: [...new Set(connectors)],
        lastRunAt: lastExecution?.startedAt,
        lastStatus: lastExecution?.status,
      };
    });
    const aiProvider = migrateDesktopAiProvider(core.store.getSetting('aiProvider', undefined));
    const aiToml = await readAiToml();
    const gmailConn = core.store.getConnections().find((c) => c.connector === 'gmail');
    const gmailRecord = parseGmailConnectionConfig(gmailConn?.config);
    const slackConn = core.store.getConnections().find((c) => c.connector === 'slack');
    const slackStatus = getSlackConnectionStatus(
      slackConn?.config,
      Boolean(slackConn?.connected),
      core.triggerEngine.slackSocketActive(),
    );
    const localFolderConn = core.store.getConnections().find((c) => c.connector === 'local_folder');
    const localFolderStatus = getLocalFolderConnectionStatus(
      localFolderConn?.config,
      Boolean(localFolderConn?.connected),
    );
    return {
      globalActive: core.store.getSetting('globalActive', true),
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
      slackConnectionMode: slackStatus.mode,
      slackLastError: slackStatus.lastError,
      localFolders: localFolderStatus.folders,
      works,
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
