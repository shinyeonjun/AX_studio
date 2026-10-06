import type { AiBrand, AiConnectionMode } from './ai-provider';
import type { ConnectionEntry } from './connection-entry';
import type { ExecutionHistoryDiagnostic, LocalFolderEntry } from '@ax-studio/core';

export interface AiProviderState {
  provider?: string;
  model?: string;
  brand?: AiBrand;
  mode?: AiConnectionMode;
}

export interface WorkSummary {
  id: string;
  name: string;
  active: boolean;
  latestVersion: number;
  goal?: string;
  trigger?: { type: string; schedule?: string; runAt?: string };
  connectors?: string[];
  lastRunAt?: string;
  lastStatus?: string;
  /** The latest stored version could not be parsed; the row is listed so it can be deleted. */
  corrupted?: true;
}

/** Display copy of one gated action, as stored on the approval payload. */
interface ApprovalActionSnapshot {
  actionId?: string;
  actionRef?: string;
  params?: Record<string, unknown>;
  /** Some display fields were shortened; the full values exist only in the stored execution. */
  truncated?: true;
  truncatedFields?: Array<{ path: string; originalLength: number }>;
  paramsHash?: string;
}

export interface AppState {
  globalActive: boolean;
  aiProvider?: AiProviderState;
  aiProviderLabel?: string;
  aiProviderInstalled?: boolean;
  envFilePath?: string;
  aiConfigPath?: string;
  axDataRoot?: string;
  aiBrandConfigs?: Partial<Record<AiBrand, { mode?: AiConnectionMode; model?: string }>>;
  jevDecisionEnabled?: boolean;
  jevDecisionConfigured?: boolean;
  jevDecisionModel?: string;
  gmailOAuthConfigured?: boolean;
  gmailEmail?: string;
  gmailScopes?: string[];
  gmailConnectedAt?: string;
  slackTeam?: string;
  slackBotUser?: string;
  slackHasAppToken?: boolean;
  slackSocketModeActive?: boolean;
  slackSocketStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  slackConnectionMode?: 'disconnected' | 'poll' | 'socket';
  slackLastError?: string;
  /** Linux only: the OS keyring is unavailable and secrets use an obfuscated (not encrypted) store. */
  credentialStorageWarning?: 'basic_text_backend';
  /** The native SQLite backend failed to load; the in-memory sql.js fallback persists less safely. */
  databaseBackendFallback?: boolean;
  localFolders?: LocalFolderEntry[];
  works: WorkSummary[];
  connections: ConnectionEntry[];
  pendingApprovals: number;
  approvals: Array<{
    id: string;
    reason: string;
    title?: string;
    createdAt: string;
    actionIds: string[];
    payload?: { actionSnapshots?: ApprovalActionSnapshot[] } | null;
  }>;
  executions: Array<{
    id: string;
    workflowId?: string | null;
    /** True when this execution came from a one-off request rather than a saved workflow. */
    ephemeral?: boolean;
    /** The workspace conversation that owns a one-off result, when available. */
    workspaceSessionId?: string;
    status: string;
    hasOutput?: boolean;
    historyDiagnostics?: ExecutionHistoryDiagnostic[];
    startedAt: string;
    finishedAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string;
    technicalStatus?: string;
    resultStatus?: 'passed' | 'failed' | 'not_evaluated';
    triggerType?: string | null;
    currentStepId?: string;
    currentStepStatus?: string;
    currentStepMessage?: string;
    lastLogMessage?: string;
    aiOutput?: {
      stepId: string;
      fields: string[];
      preview: Record<string, string>;
    };
    generatedPdf?: {
      artifactId: string;
      fileName: string;
      size: number;
      mimeType: 'application/pdf';
    };
  }>;
}
