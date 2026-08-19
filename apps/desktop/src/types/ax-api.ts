import type { AiProviderState } from './app-state';
import type {
  AiApiTestResult,
  AiCliTestResult,
  AiConfigSnapshot,
  AiSecretStatus,
  CursorApiKeyTestResult,
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
  setGlobalActive: (active: boolean) => Promise<unknown>;
  setSkillActive: (skillId: string, active: boolean) => Promise<unknown>;
  explain: (q: string) => Promise<string>;
  proposeRevision: (skillId: string, instruction: string) => Promise<unknown>;
  connectSlack: (token: string) => Promise<unknown>;
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
  setCursorApiKey: (key: string) => Promise<{ ok: boolean; masked?: string }>;
  testCursorApiKey: (key?: string) => Promise<CursorApiKeyTestResult>;
  summarize: (ir: unknown) => Promise<string>;
  printPdf: (html: string) => Promise<unknown>;
  onAgentProgress: (listener: (event: { message: string }) => void) => () => void;
}

declare global {
  interface Window {
    ax: AxApi;
  }
}
