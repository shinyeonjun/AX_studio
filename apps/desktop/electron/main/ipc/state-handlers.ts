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
import { summarizeConnections } from './connection-state-summary.js';
import { executionLogSummary } from './execution-log-summary.js';

function executionQualityState(execution: {
  status: string;
  errorCode: string | null;
  irJson?: string;
}): { technicalStatus: string; resultStatus: 'passed' | 'failed' | 'not_evaluated' } {
  if (execution.errorCode === 'input_schema_drift') {
    return { technicalStatus: 'blocked', resultStatus: 'not_evaluated' };
  }
  if (execution.errorCode === 'output_contract_failed') {
    return { technicalStatus: 'completed', resultStatus: 'failed' };
  }
  if (execution.status === 'success') {
    let hasOutputContract = false;
    if (execution.irJson) {
      try {
        hasOutputContract = Boolean(parseWorkflowIR(JSON.parse(execution.irJson)).outputContract);
      } catch {
        hasOutputContract = false;
      }
    }
    return { technicalStatus: 'completed', resultStatus: hasOutputContract ? 'passed' : 'not_evaluated' };
  }
  if (execution.status === 'pending_approval') {
    return { technicalStatus: 'waiting_approval', resultStatus: 'not_evaluated' };
  }
  return { technicalStatus: execution.status, resultStatus: 'not_evaluated' };
}

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
      const logSummary = executionLogSummary(execution.logJson);
      const quality = executionQualityState(execution);
      const errorMessage =
        logSummary.errorMessage ??
        (execution.status === 'failed' && execution.logJson ? '실행 로그를 읽지 못했습니다.' : undefined);
      return {
        id: execution.id,
        workflowId: execution.workflowId,
        status: execution.status,
        startedAt: execution.startedAt,
        finishedAt: execution.finishedAt,
        errorCode: execution.errorCode,
        errorMessage,
        technicalStatus: quality.technicalStatus,
        resultStatus: quality.resultStatus,
        triggerType: execution.triggerType,
        currentStepId: logSummary.currentStepId,
        currentStepStatus: logSummary.currentStepStatus,
        currentStepMessage: logSummary.currentStepMessage,
        lastLogMessage: logSummary.lastLogMessage,
        aiOutput: logSummary.aiOutput,
        generatedPdf: logSummary.generatedPdf,
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
    const slackSocketStatus = core.triggerEngine.slackSocketStatus();
    const slackStatus = getSlackConnectionStatus(
      slackConn?.config,
      Boolean(slackConn?.connected),
      slackSocketStatus.phase === 'connected' && core.triggerEngine.slackSocketActive(),
    );
    const webhookTransport = core.triggerEngine.pushTransportStatus('webhook.inbound');
    const localFolderConn = core.store.getConnections().find((c) => c.connector === 'local_folder');
    const localFolderStatus = getLocalFolderConnectionStatus(
      localFolderConn?.config,
      Boolean(localFolderConn?.connected),
    );
    return {
      globalActive: core.store.getGlobalActive(),
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
      works,
      connections: await summarizeConnections(core.store.getConnections(), { webhookTransport }),
      pendingApprovals: pendingApprovals.length,
      approvals: pendingApprovals,
      executions,
    };
  });
}
