import type { AiProviderState } from './app-state';
import type {
  AiApiTestResult,
  AiCliTestResult,
  AiConfigSnapshot,
  AiSecretStatus,
  DetectedAiCli,
} from './ai-provider';

export interface AxApi {
  getState: () => Promise<unknown>;
  startInterview: (instruction: string) => Promise<unknown>;
  applyAnswer: (state: unknown, answer: string) => Promise<unknown>;
  saveSkill: (ir: unknown) => Promise<unknown>;
  runSkill: (skillId: string) => Promise<unknown>;
  runEphemeral: (ir: unknown) => Promise<unknown>;
  approve: (id: string) => Promise<unknown>;
  reject: (id: string) => Promise<unknown>;
  deleteSkill: (skillId: string) => Promise<unknown>;
  deleteExecution: (executionId: string) => Promise<unknown>;
  clearExecutions: () => Promise<{ ok: boolean; removed: number }>;
  setGlobalActive: (active: boolean) => Promise<unknown>;
  setSkillActive: (skillId: string, active: boolean) => Promise<unknown>;
  explain: (q: string) => Promise<string>;
  proposeRevision: (skillId: string, instruction: string) => Promise<unknown>;
  connectSlack: (payload: string | { token: string; appToken?: string }) => Promise<unknown>;
  connectGmailOAuth: () => Promise<{ ok: boolean; email?: string }>;
  disconnectGmailOAuth: () => Promise<{ ok: boolean }>;
  setAiProvider: (config: AiProviderState) => Promise<unknown>;
  detectAiCli: () => Promise<DetectedAiCli[]>;
  getAiConfig: () => Promise<AiConfigSnapshot>;
  saveAiBrandConfig: (
    brand: string,
    prefs: { mode?: string; model?: string; apiKey?: string },
  ) => Promise<{ ok: boolean }>;
  testAiCli: (brand: string) => Promise<AiCliTestResult>;
  testAiApi: (brand: string, apiKey?: string, mode?: string) => Promise<AiApiTestResult>;
  setEnvSecret: (key: string, value: string) => Promise<{ ok: boolean; masked?: string }>;
  getEnvSecretStatus: (key: string) => Promise<{ configured: boolean; masked?: string; envFilePath?: string }>;
  summarize: (ir: unknown) => Promise<string>;
  loadSkillChat: (skillId: string) => Promise<{ state: unknown; summary?: string; title?: string }>;
  saveChatSession: (state: unknown, summary?: string, skillId?: string) => Promise<{ ok: boolean }>;
  printPdf: (html: string) => Promise<unknown>;
  onAgentProgress: (listener: (event: { message: string }) => void) => () => void;
  onStateChanged: (listener: () => void) => () => void;
}

declare global {
  interface Window {
    ax: AxApi;
  }
}
