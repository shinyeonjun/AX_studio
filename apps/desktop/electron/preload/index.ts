import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceExecutionMode } from '@ax-studio/core';

contextBridge.exposeInMainWorld('ax', {
  getState: () => ipcRenderer.invoke('ax:getState'),
  executeCommand: (command: unknown) => ipcRenderer.invoke('ax:command', command),
  approve: (id: string) => ipcRenderer.invoke('ax:approve', id),
  reject: (id: string) => ipcRenderer.invoke('ax:reject', id),
  deleteWorkflow: (workflowId: string) => ipcRenderer.invoke('ax:deleteWorkflow', workflowId),
  deleteExecution: (executionId: string) => ipcRenderer.invoke('ax:deleteExecution', executionId),
  clearExecutions: () => ipcRenderer.invoke('ax:clearExecutions'),
  setGlobalActive: (active: boolean) => ipcRenderer.invoke('ax:setGlobalActive', active),
  setWorkflowActive: (workflowId: string, active: boolean) => ipcRenderer.invoke('ax:setWorkflowActive', workflowId, active),
  explain: (q: string) => ipcRenderer.invoke('ax:explain', q),
  connectSlack: (payload: string | { token: string; appToken?: string }) =>
    ipcRenderer.invoke('ax:connectSlack', payload),
  connectGmailOAuth: () => ipcRenderer.invoke('ax:connectGmailOAuth'),
  disconnectGmailOAuth: () => ipcRenderer.invoke('ax:disconnectGmailOAuth'),
  pickLocalFolder: () => ipcRenderer.invoke('ax:pickLocalFolder'),
  addLocalFolder: (payload: { path: string; label?: string }) => ipcRenderer.invoke('ax:addLocalFolder', payload),
  removeLocalFolder: (folderId: string) => ipcRenderer.invoke('ax:removeLocalFolder', folderId),
  connectHttp: (payload: {
    baseUrl: string;
    label?: string;
    authType: 'none' | 'bearer' | 'apiKey' | 'basic';
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  }) => ipcRenderer.invoke('ax:connectHttp', payload),
  disconnectHttp: () => ipcRenderer.invoke('ax:disconnectHttp'),
  connectWebhook: (payload: { port: number; secret: string; label?: string; tunnelUrl?: string }) =>
    ipcRenderer.invoke('ax:connectWebhook', payload),
  disconnectWebhook: () => ipcRenderer.invoke('ax:disconnectWebhook'),
  pickSqliteFile: () => ipcRenderer.invoke('ax:pickSqliteFile'),
  connectRdb: (payload: {
    type: 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => ipcRenderer.invoke('ax:connectRdb', payload),
  disconnectRdb: () => ipcRenderer.invoke('ax:disconnectRdb'),
  connectOpenApi: (payload: {
    specId: string;
    label?: string;
    specUrl?: string;
    specJson?: string;
  }) => ipcRenderer.invoke('ax:connectOpenApi', payload),
  disconnectOpenApi: () => ipcRenderer.invoke('ax:disconnectOpenApi'),
  connectMcp: (payload: { serverId: string; label?: string; toolsJson: string }) =>
    ipcRenderer.invoke('ax:connectMcp', payload),
  disconnectMcp: () => ipcRenderer.invoke('ax:disconnectMcp'),
  setAiProvider: (config: unknown) => ipcRenderer.invoke('ax:setAiProvider', config),
  detectAiCli: () => ipcRenderer.invoke('ax:detectAiCli'),
  getAiConfig: () => ipcRenderer.invoke('ax:getAiConfig'),
  saveAiBrandConfig: (brand: string, prefs: unknown) => ipcRenderer.invoke('ax:saveAiBrandConfig', brand, prefs),
  testAiCli: (brand: string) => ipcRenderer.invoke('ax:testAiCli', brand),
  testAiApi: (brand: string, apiKey?: string, mode?: string) => ipcRenderer.invoke('ax:testAiApi', brand, apiKey, mode),
  setEnvSecret: (key: string, value: string) => ipcRenderer.invoke('ax:setEnvSecret', key, value),
  getEnvSecretStatus: (key: string) => ipcRenderer.invoke('ax:getEnvSecretStatus', key),
  printPdf: (html: string) => ipcRenderer.invoke('ax:printPdf', html),
  loadWorkChat: (workflowId: string) => ipcRenderer.invoke('ax:loadWorkChat', workflowId),
  sendCommandChat: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    requestId?: string,
    workflowId?: string,
    executionMode?: WorkspaceExecutionMode,
  ) => ipcRenderer.invoke('ax:sendCommandChat', messages, requestId, workflowId, executionMode),
  cancelChat: (requestId: string) => ipcRenderer.invoke('ax:cancelChat', requestId),
  listChatSessions: () => ipcRenderer.invoke('ax:listChatSessions'),
  saveWorkspaceChat: (
    id: string | undefined,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    workflowId?: string,
    executionMode?: WorkspaceExecutionMode,
  ) => ipcRenderer.invoke('ax:saveWorkspaceChat', id, messages, workflowId, executionMode),
  loadWorkspaceChat: (id: string) => ipcRenderer.invoke('ax:loadWorkspaceChat', id),
  loadWorkspaceChatByWorkflowId: (workflowId: string) => ipcRenderer.invoke('ax:loadWorkspaceChatByWorkflowId', workflowId),
  deleteWorkspaceChat: (id: string) => ipcRenderer.invoke('ax:deleteWorkspaceChat', id),
  onChatProgress: (listener: (event: { message: string; requestId?: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { message: string; requestId?: string }) =>
      listener(payload);
    ipcRenderer.on('ax:chat-progress', wrapped);
    return () => ipcRenderer.removeListener('ax:chat-progress', wrapped);
  },
  onStateChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on('ax:state-changed', wrapped);
    return () => ipcRenderer.removeListener('ax:state-changed', wrapped);
  },
});
