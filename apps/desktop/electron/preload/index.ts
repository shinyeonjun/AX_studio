import { contextBridge, ipcRenderer } from 'electron';
import type {
  WorkspaceChatChangedEvent,
  WorkspaceChatMessage,
  WorkspaceChatSaveOptions,
  WorkspaceSourceRecord,
  ToolResultConfirmation,
  ToolDraftUpdate, ToolReviewRequest,
} from '@ax-studio/core';

contextBridge.exposeInMainWorld('ax', {
  getState: () => ipcRenderer.invoke('ax:getState'),
  approve: (id: string) => ipcRenderer.invoke('ax:approve', id),
  confirmToolResult: (confirmation: ToolResultConfirmation) => ipcRenderer.invoke('ax:confirmToolResult', confirmation),
  getToolResult: (lookup: string | { executionId: string }) => ipcRenderer.invoke('ax:getToolResult', lookup),
  updateToolDraft: (input: ToolDraftUpdate) => ipcRenderer.invoke('ax:updateToolDraft', input),
  reviewToolResult: (input: ToolReviewRequest) => ipcRenderer.invoke('ax:reviewToolResult', input),
  reject: (id: string) => ipcRenderer.invoke('ax:reject', id),
  deleteWorkflow: (workflowId: string) => ipcRenderer.invoke('ax:deleteWorkflow', workflowId),
  deleteExecution: (executionId: string) => ipcRenderer.invoke('ax:deleteExecution', executionId),
  getExecutionOutput: (executionId: string) => ipcRenderer.invoke('ax:getExecutionOutput', executionId),
  clearExecutions: () => ipcRenderer.invoke('ax:clearExecutions'),
  exportGeneratedArtifact: (artifactId: string) => ipcRenderer.invoke('ax:exportGeneratedArtifact', artifactId),
  saveGeneratedArtifactToFolder: (artifactId: string) => ipcRenderer.invoke('ax:saveGeneratedArtifactToFolder', artifactId),
  setWorkflowActive: (workflowId: string, active: boolean) => ipcRenderer.invoke('ax:setWorkflowActive', workflowId, active),
  runWorkflow: (workflowId: string) => ipcRenderer.invoke('ax:runWorkflow', workflowId),
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
  setAiProvider: (config: unknown) => ipcRenderer.invoke('ax:setAiProvider', config),
  detectAiCli: () => ipcRenderer.invoke('ax:detectAiCli'),
  getAiConfig: () => ipcRenderer.invoke('ax:getAiConfig'),
  saveAiBrandConfig: (brand: string, prefs: unknown) => ipcRenderer.invoke('ax:saveAiBrandConfig', brand, prefs),
  testAiCli: (brand: string) => ipcRenderer.invoke('ax:testAiCli', brand),
  testAiApi: (brand: string, apiKey?: string, mode?: string) => ipcRenderer.invoke('ax:testAiApi', brand, apiKey, mode),
  getJevDecisionConfig: () => ipcRenderer.invoke('ax:getJevDecisionConfig'),
  saveJevDecisionConfig: (prefs: unknown) => ipcRenderer.invoke('ax:saveJevDecisionConfig', prefs),
  testJevDecisionApi: (prefs?: unknown) => ipcRenderer.invoke('ax:testJevDecisionApi', prefs),
  loadWorkChat: (workflowId: string) => ipcRenderer.invoke('ax:loadWorkChat', workflowId),
  sendCommandChat: (
    userMessage: string,
    requestId?: string,
    workflowId?: string,
    workspaceSessionId?: string,
    options?: Pick<WorkspaceChatSaveOptions, 'metadataLane'>,
  ) => ipcRenderer.invoke('ax:sendCommandChat', userMessage, requestId, workflowId, workspaceSessionId, options),
  proposeRecurringFromExecution: (workspaceSessionId: string, executionId: string, scheduleValue: string) =>
    ipcRenderer.invoke('ax:proposeRecurringFromExecution', workspaceSessionId, executionId, scheduleValue),
  proposeRecurringFromRead: (workspaceSessionId: string, scheduleValue: string) =>
    ipcRenderer.invoke('ax:proposeRecurringFromRead', workspaceSessionId, scheduleValue),
  cancelChat: (requestId: string) => ipcRenderer.invoke('ax:cancelChat', requestId),
  listChatSessions: () => ipcRenderer.invoke('ax:listChatSessions'),
  saveWorkspaceChat: (
    id: string | undefined,
    messages: WorkspaceChatMessage[],
    workflowId?: string | null,
    options?: WorkspaceChatSaveOptions,
  ) => ipcRenderer.invoke('ax:saveWorkspaceChat', id, messages, workflowId, options),
  loadWorkspaceChat: (id: string) => ipcRenderer.invoke('ax:loadWorkspaceChat', id),
  loadWorkspaceChatByWorkflowId: (workflowId: string) => ipcRenderer.invoke('ax:loadWorkspaceChatByWorkflowId', workflowId),
  deleteWorkspaceChat: (id: string) => ipcRenderer.invoke('ax:deleteWorkspaceChat', id),
  listWorkspaceSources: (sessionId: string) => ipcRenderer.invoke('ax:listWorkspaceSources', sessionId),
  attachWorkspaceSource: (sessionId?: string | null) => ipcRenderer.invoke('ax:attachWorkspaceSource', sessionId),
  exportDiagnostics: () => ipcRenderer.invoke('ax:exportDiagnostics'),
  openLogFolder: () => ipcRenderer.invoke('ax:openLogFolder'),
  // The main process adds this switch only for unpackaged AX_E2E runs, the
  // same gate its e2e IPC handlers use; environment variables alone never
  // expose these stubs in a packaged app.
  ...(process.argv.includes('--ax-e2e-stubs')
    ? {
        e2eSetWorkspaceSourcePath: (filePath: string) => ipcRenderer.invoke('ax:e2eSetWorkspaceSourcePath', filePath),
        e2eSetDiscoveryArtifactPath: (filePath: string) => ipcRenderer.invoke('ax:e2eSetDiscoveryArtifactPath', filePath),
        e2eConfigureDiscoveryFolder: (folderPath: string) => ipcRenderer.invoke('ax:e2eConfigureDiscoveryFolder', folderPath),
      }
    : {}),
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
  onWorkspaceChatChanged: (listener: (event: WorkspaceChatChangedEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: WorkspaceChatChangedEvent) => listener(payload);
    ipcRenderer.on('ax:workspace-chat-changed', wrapped);
    return () => ipcRenderer.removeListener('ax:workspace-chat-changed', wrapped);
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
  discoveryRetry: (payload: { sessionId: string; expectedRevision: number }) =>
    ipcRenderer.invoke('ax:discoveryRetry', payload),
  discoveryAnswer: (payload: {
    sessionId: string;
    questionId: string;
    optionId: string;
    expectedRevision?: number;
  }) => ipcRenderer.invoke('ax:discoveryAnswer', payload),
  discoveryResumable: () => ipcRenderer.invoke('ax:discoveryResumable'),
  discoveryPublish: (payload: {
    sessionId: string;
    name?: string;
    expectedRevision?: number;
  }) => ipcRenderer.invoke('ax:discoveryPublish', payload),
});
