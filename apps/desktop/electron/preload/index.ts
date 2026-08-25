import { contextBridge, ipcRenderer } from 'electron';
import type { AxInputRequest, AxUiPresentation, WorkspaceSourceRecord } from '@ax-studio/core';

contextBridge.exposeInMainWorld('ax', {
  getState: () => ipcRenderer.invoke('ax:getState'),
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
  disconnectSlack: () => ipcRenderer.invoke('ax:disconnectSlack'),
  connectGmailOAuth: () => ipcRenderer.invoke('ax:connectGmailOAuth'),
  disconnectGmailOAuth: () => ipcRenderer.invoke('ax:disconnectGmailOAuth'),
  pickLocalFolder: () => ipcRenderer.invoke('ax:pickLocalFolder'),
  addLocalFolder: (payload: { path: string; label?: string }) => ipcRenderer.invoke('ax:addLocalFolder', payload),
  removeLocalFolder: (folderId: string) => ipcRenderer.invoke('ax:removeLocalFolder', folderId),
  connectHttp: (payload: {
    endpointId?: string;
    baseUrl: string;
    label?: string;
    authType: 'none' | 'bearer' | 'apiKey' | 'basic';
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  }) => ipcRenderer.invoke('ax:connectHttp', payload),
  disconnectHttp: (endpointId?: string) => ipcRenderer.invoke('ax:disconnectHttp', endpointId),
  connectWebhook: (payload: { port: number; secret: string; label?: string; tunnelUrl?: string }) =>
    ipcRenderer.invoke('ax:connectWebhook', payload),
  disconnectWebhook: () => ipcRenderer.invoke('ax:disconnectWebhook'),
  pickSqliteFile: () => ipcRenderer.invoke('ax:pickSqliteFile'),
  connectRdb: (payload: {
    type: 'mysql' | 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
    allowedSchemas?: string[];
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
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      inputRequests?: AxInputRequest[];
      presentations?: AxUiPresentation[];
    }>,
    requestId?: string,
    workflowId?: string,
    workspaceSessionId?: string,
  ) => ipcRenderer.invoke('ax:sendCommandChat', messages, requestId, workflowId, workspaceSessionId),
  cancelChat: (requestId: string) => ipcRenderer.invoke('ax:cancelChat', requestId),
  listChatSessions: () => ipcRenderer.invoke('ax:listChatSessions'),
  saveWorkspaceChat: (
    id: string | undefined,
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      inputRequests?: AxInputRequest[];
      presentations?: AxUiPresentation[];
    }>,
    workflowId?: string | null,
  ) => ipcRenderer.invoke('ax:saveWorkspaceChat', id, messages, workflowId),
  loadWorkspaceChat: (id: string) => ipcRenderer.invoke('ax:loadWorkspaceChat', id),
  loadWorkspaceChatByWorkflowId: (workflowId: string) => ipcRenderer.invoke('ax:loadWorkspaceChatByWorkflowId', workflowId),
  deleteWorkspaceChat: (id: string) => ipcRenderer.invoke('ax:deleteWorkspaceChat', id),
  listWorkspaceSources: (sessionId: string) => ipcRenderer.invoke('ax:listWorkspaceSources', sessionId),
  attachWorkspaceSource: (sessionId?: string | null) => ipcRenderer.invoke('ax:attachWorkspaceSource', sessionId),
  e2eAttachWorkspaceSource: (sessionId: string | null | undefined, filePath: string) =>
    ipcRenderer.invoke('ax:e2eAttachWorkspaceSource', sessionId, filePath),
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
  onWorkspaceSourceChanged: (listener: (event: { sessionId: string; source: WorkspaceSourceRecord }) => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; source: WorkspaceSourceRecord },
    ) => listener(payload);
    ipcRenderer.on('ax:workspace-source-changed', wrapped);
    return () => ipcRenderer.removeListener('ax:workspace-source-changed', wrapped);
  },
  importArtifact: () => ipcRenderer.invoke('ax:importArtifact'),
  discoveryStart: (payload: {
    goal: string;
    exampleArtifactIds: string[];
    inputArtifactIds?: string[];
    desiredRecurrence?: string;
  }) => ipcRenderer.invoke('ax:discoveryStart', payload),
  discoveryInspect: (sessionId: string) => ipcRenderer.invoke('ax:discoveryInspect', sessionId),
  discoveryCancel: (sessionId: string) => ipcRenderer.invoke('ax:discoveryCancel', sessionId),
  discoveryAnswer: (payload: {
    sessionId: string;
    questionId: string;
    optionId: string;
    expectedRevision?: number;
  }) => ipcRenderer.invoke('ax:discoveryAnswer', payload),
  discoveryPublish: (payload: {
    sessionId: string;
    name?: string;
    expectedRevision?: number;
  }) => ipcRenderer.invoke('ax:discoveryPublish', payload),
});
