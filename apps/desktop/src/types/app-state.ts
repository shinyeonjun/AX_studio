import type { AiBrand, AiConnectionMode } from './ai-provider';

export interface AiProviderState {
  provider?: string;
  model?: string;
  brand?: AiBrand;
  mode?: AiConnectionMode;
}

export interface SkillSummary {
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
  cursorApiKeyConfigured?: boolean;
  cursorApiKeyMasked?: string;
  envFilePath?: string;
  aiConfigPath?: string;
  aiBrandConfigs?: Partial<Record<AiBrand, { mode?: AiConnectionMode; model?: string }>>;
  gmailOAuthConfigured?: boolean;
  gmailEmail?: string;
  gmailScopes?: string[];
  gmailConnectedAt?: string;
  skills: SkillSummary[];
  connections: Array<{ connector: string; connected: boolean; account?: string; scopes?: string[] }>;
  pendingApprovals: number;
  approvals: Array<{
    id: string;
    reason: string;
    createdAt: string;
    actionIds: string[];
  }>;
  executions: Array<{
    id: string;
    skillId?: string | null;
    status: string;
    startedAt: string;
    errorCode?: string | null;
    triggerType?: string | null;
  }>;
}
