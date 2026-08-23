import type { AxInputRequest, AxUiPresentation } from '@ax-studio/core';
import type { AiProviderState } from './app-state';
import type {
  AiApiTestResult,
  AiCliTestResult,
  AiConfigSnapshot,
  AiSecretStatus,
  DetectedAiCli,
} from './ai-provider';

export interface AxCommandResult {
  command: string;
  status: string;
  data?: unknown;
  issues?: Array<{ code: string; message: string; path?: string }>;
}

export interface AxApi {
  getState: () => Promise<unknown>;
  approve: (id: string) => Promise<unknown>;
  reject: (id: string) => Promise<unknown>;
  deleteWorkflow: (workflowId: string) => Promise<unknown>;
  deleteExecution: (executionId: string) => Promise<unknown>;
  clearExecutions: () => Promise<{ ok: boolean; removed: number }>;
  setGlobalActive: (active: boolean) => Promise<unknown>;
  setWorkflowActive: (workflowId: string, active: boolean) => Promise<unknown>;
  sendCommandChat: (
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      inputRequests?: AxInputRequest[];
      presentations?: AxUiPresentation[];
    }>,
    requestId?: string,
    workflowId?: string,
  ) => Promise<{
    role: 'assistant';
    content: string;
    requestId: string;
    changedWorkflowIds: string[];
    removedWorkflowIds: string[];
    inputRequests: AxInputRequest[];
    presentations: AxUiPresentation[];
  }>;
  cancelChat: (requestId: string) => Promise<{ ok: boolean }>;
  listChatSessions: () => Promise<
    Array<{
      id: string;
      title: string;
      updatedAt: string;
      kind: 'workspace';
      workflowId?: string;
      corrupted?: boolean;
    }>
  >;
  saveWorkspaceChat: (
    id: string | undefined,
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      inputRequests?: AxInputRequest[];
      presentations?: AxUiPresentation[];
    }>,
    workflowId?: string | null,
  ) => Promise<{
    id: string;
    title: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      inputRequests?: AxInputRequest[];
      presentations?: AxUiPresentation[];
    }>;
    workflowId?: string;
    updatedAt: string;
  }>;
  loadWorkspaceChat: (id: string) => Promise<{
    id: string;
    title: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      inputRequests?: AxInputRequest[];
      presentations?: AxUiPresentation[];
    }>;
    workflowId?: string;
    updatedAt: string;
  }>;
  loadWorkspaceChatByWorkflowId: (workflowId: string) => Promise<{
    id: string;
    title: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      inputRequests?: AxInputRequest[];
      presentations?: AxUiPresentation[];
    }>;
    workflowId?: string;
    updatedAt: string;
  } | null>;
  deleteWorkspaceChat: (id: string) => Promise<{ ok: boolean }>;
  onChatProgress?: (listener: (event: { message: string; requestId?: string }) => void) => () => void;
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
  pickSqliteFile: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  connectRdb: (payload: {
    type: 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => Promise<unknown>;
  disconnectRdb: () => Promise<unknown>;
  connectOpenApi: (payload: {
    specId: string;
    label?: string;
    specUrl?: string;
    specJson?: string;
  }) => Promise<unknown>;
  disconnectOpenApi: () => Promise<unknown>;
  connectMcp: (payload: { serverId: string; label?: string; toolsJson: string }) => Promise<unknown>;
  disconnectMcp: () => Promise<unknown>;
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
  printPdf: (html: string) => Promise<unknown>;
  onStateChanged: (listener: () => void) => () => void;
  importArtifact: () => Promise<
    | { ok: true; artifact: { id: string; fileName: string; storedPath: string; sha256: string; size: number; createdAt: string } }
    | { ok: false; canceled: true }
    | { ok: false; error: string }
  >;
  discoveryStart: (payload: {
    goal: string;
    exampleArtifactIds: string[];
    inputArtifactIds?: string[];
    desiredRecurrence?: string;
  }) => Promise<AxCommandResult>;
  discoveryInspect: (sessionId: string) => Promise<AxCommandResult>;
  discoveryCancel: (sessionId: string) => Promise<AxCommandResult>;
  discoveryAnswer: (payload: {
    sessionId: string;
    questionId: string;
    optionId: string;
    expectedRevision?: number;
  }) => Promise<AxCommandResult>;
  discoveryPublish: (payload: {
    sessionId: string;
    name?: string;
    expectedRevision?: number;
  }) => Promise<AxCommandResult>;
}

declare global {
  interface Window {
    ax: AxApi;
  }
}
