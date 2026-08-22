import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ax', {
  getState: () => ipcRenderer.invoke('ax:getState'),
  startInterview: (instruction: string, workScope?: 'once' | 'recurring') =>
    ipcRenderer.invoke('ax:startInterview', instruction, workScope),
  applyAnswer: (state: unknown, answer: string) => ipcRenderer.invoke('ax:applyAnswer', state, answer),
  saveWorkflow: (ir: unknown) => ipcRenderer.invoke('ax:saveWorkflow', ir),
  runWorkflow: (workflowId: string) => ipcRenderer.invoke('ax:runWorkflow', workflowId),
  runEphemeral: (ir: unknown) => ipcRenderer.invoke('ax:runEphemeral', ir),
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
  setAiProvider: (config: unknown) => ipcRenderer.invoke('ax:setAiProvider', config),
  detectAiCli: () => ipcRenderer.invoke('ax:detectAiCli'),
  getAiConfig: () => ipcRenderer.invoke('ax:getAiConfig'),
  saveAiBrandConfig: (brand: string, prefs: unknown) => ipcRenderer.invoke('ax:saveAiBrandConfig', brand, prefs),
  testAiCli: (brand: string) => ipcRenderer.invoke('ax:testAiCli', brand),
  testAiApi: (brand: string, apiKey?: string, mode?: string) => ipcRenderer.invoke('ax:testAiApi', brand, apiKey, mode),
  setEnvSecret: (key: string, value: string) => ipcRenderer.invoke('ax:setEnvSecret', key, value),
  getEnvSecretStatus: (key: string) => ipcRenderer.invoke('ax:getEnvSecretStatus', key),
  printPdf: (html: string) => ipcRenderer.invoke('ax:printPdf', html),
  summarize: (ir: unknown) => ipcRenderer.invoke('ax:summarize', ir),
  loadWorkChat: (workflowId: string) => ipcRenderer.invoke('ax:loadWorkChat', workflowId),
  loadInterviewChat: (sessionId: string) => ipcRenderer.invoke('ax:loadInterviewChat', sessionId),
  saveChatSession: (state: unknown, summary?: string, workflowId?: string) =>
    ipcRenderer.invoke('ax:saveChatSession', state, summary, workflowId),
  sendChat: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    sessionId?: string,
  ) => ipcRenderer.invoke('ax:sendChat', messages, sessionId),
  listChatSessions: () => ipcRenderer.invoke('ax:listChatSessions'),
  saveWorkspaceChat: (id: string | undefined, messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    ipcRenderer.invoke('ax:saveWorkspaceChat', id, messages),
  loadWorkspaceChat: (id: string) => ipcRenderer.invoke('ax:loadWorkspaceChat', id),
  deleteWorkspaceChat: (id: string) => ipcRenderer.invoke('ax:deleteWorkspaceChat', id),
  deleteInterviewChatSession: (id: string) => ipcRenderer.invoke('ax:deleteInterviewChatSession', id),
  onChatProgress: (listener: (event: { message: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { message: string }) => listener(payload);
    ipcRenderer.on('ax:chat-progress', wrapped);
    return () => ipcRenderer.removeListener('ax:chat-progress', wrapped);
  },
  onStateChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on('ax:state-changed', wrapped);
    return () => ipcRenderer.removeListener('ax:state-changed', wrapped);
  },
});
