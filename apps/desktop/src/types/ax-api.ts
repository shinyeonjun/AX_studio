import type { ExecutionResult } from '@ax-studio/core';
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
  startInterview: (instruction: string, workScope?: 'once' | 'recurring') => Promise<unknown>;
  applyAnswer: (state: unknown, answer: string) => Promise<unknown>;
  saveWorkflow: (ir: unknown) => Promise<unknown>;
  runWorkflow: (workflowId: string) => Promise<ExecutionResult>;
  runEphemeral: (ir: unknown) => Promise<ExecutionResult>;
  approve: (id: string) => Promise<unknown>;
  reject: (id: string) => Promise<unknown>;
  deleteWorkflow: (workflowId: string) => Promise<unknown>;
  deleteExecution: (executionId: string) => Promise<unknown>;
  clearExecutions: () => Promise<{ ok: boolean; removed: number }>;
  setGlobalActive: (active: boolean) => Promise<unknown>;
  setWorkflowActive: (workflowId: string, active: boolean) => Promise<unknown>;
  sendChat: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) => Promise<{ role: 'assistant'; content: string }>;
  listChatSessions: () => Promise<
    Array<{
      id: string;
      title: string;
      updatedAt: string;
      kind: 'workspace' | 'interview';
      workflowId?: string;
      corrupted?: boolean;
    }>
  >;
  saveWorkspaceChat: (
    id: string | undefined,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) => Promise<{ id: string; title: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; updatedAt: string }>;
  loadWorkspaceChat: (id: string) => Promise<{
    id: string;
    title: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    updatedAt: string;
  }>;
  deleteWorkspaceChat: (id: string) => Promise<{ ok: boolean }>;
  deleteInterviewChatSession: (id: string) => Promise<{ ok: boolean }>;
  onChatProgress?: (listener: (event: { message: string }) => void) => () => void;
  explain: (q: string) => Promise<string>;
  connectSlack: (payload: string | { token: string; appToken?: string }) => Promise<unknown>;
  connectGmailOAuth: () => Promise<{ ok: boolean; email?: string }>;
  disconnectGmailOAuth: () => Promise<{ ok: boolean }>;
  pickLocalFolder: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  addLocalFolder: (payload: { path: string; label?: string }) => Promise<unknown>;
  removeLocalFolder: (folderId: string) => Promise<unknown>;
  connectHttp: (payload: {
    baseUrl: string;
    label?: string;
    authType: 'none' | 'bearer' | 'apiKey' | 'basic';
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  }) => Promise<unknown>;
  disconnectHttp: () => Promise<unknown>;
  connectWebhook: (payload: {
    port: number;
    secret: string;
    label?: string;
    tunnelUrl?: string;
  }) => Promise<unknown>;
  disconnectWebhook: () => Promise<unknown>;
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
  loadWorkChat: (workflowId: string) => Promise<{ state: unknown; summary?: string; title?: string }>;
  loadInterviewChat: (sessionId: string) => Promise<{ state: unknown; summary?: string; title?: string }>;
  saveChatSession: (state: unknown, summary?: string, workflowId?: string) => Promise<{ ok: boolean }>;
  printPdf: (html: string) => Promise<unknown>;
  onStateChanged: (listener: () => void) => () => void;
}

declare global {
  interface Window {
    ax: AxApi;
  }
}
