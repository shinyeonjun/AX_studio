import type { AiProviderState } from '../app-state.js';
import type {
  AiApiTestResult,
  AiCliTestResult,
  AiConfigSnapshot,
  DetectedAiCli,
} from '../ai-provider.js';

export interface JevDecisionConfigSnapshot {
  enabled: boolean;
  model: string;
  baseURL: string;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
}

export interface JevDecisionConfigInput {
  enabled?: boolean;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

export interface AxAiApi {
  setAiProvider: (config: AiProviderState) => Promise<unknown>;
  detectAiCli: () => Promise<DetectedAiCli[]>;
  getAiConfig: () => Promise<AiConfigSnapshot>;
  saveAiBrandConfig: (
    brand: string,
    prefs: { mode?: string; model?: string; apiKey?: string },
  ) => Promise<{ ok: boolean }>;
  testAiCli: (brand: string) => Promise<AiCliTestResult>;
  testAiApi: (brand: string, apiKey?: string, mode?: string) => Promise<AiApiTestResult>;
  getJevDecisionConfig: () => Promise<JevDecisionConfigSnapshot>;
  saveJevDecisionConfig: (prefs: JevDecisionConfigInput) => Promise<JevDecisionConfigSnapshot>;
  testJevDecisionApi: (prefs?: Omit<JevDecisionConfigInput, 'enabled'>) => Promise<{
    ok: boolean;
    model: string;
    masked?: string;
    saved: boolean;
  }>;
  setEnvSecret: (key: string, value: string) => Promise<{ ok: boolean; masked?: string }>;
  getEnvSecretStatus: (key: string) => Promise<{ configured: boolean; masked?: string; envFilePath?: string }>;
}
