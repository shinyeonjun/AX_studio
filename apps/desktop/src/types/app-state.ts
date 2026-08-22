import type { AiBrand, AiConnectionMode } from './ai-provider';
import type { LocalFolderEntry } from './local-folder';

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
  gmailOAuthConfigured?: boolean;
  gmailEmail?: string;
  gmailScopes?: string[];
  gmailConnectedAt?: string;
  slackTeam?: string;
  slackBotUser?: string;
  slackHasAppToken?: boolean;
  slackSocketModeActive?: boolean;
  slackConnectionMode?: 'disconnected' | 'poll' | 'socket';
  slackLastError?: string;
  localFolders?: LocalFolderEntry[];
  works: WorkSummary[];
  connections: Array<{ connector: string; connected: boolean; account?: string; scopes?: string[] }>;
  pendingApprovals: number;
  approvals: Array<{
    id: string;
    reason: string;
    title?: string;
    createdAt: string;
    actionIds: string[];
  }>;
  executions: Array<{
    id: string;
    workflowId?: string | null;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string;
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
  }>;
}
