import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ax', {
  getState: () => ipcRenderer.invoke('ax:getState'),
  startInterview: (instruction: string) => ipcRenderer.invoke('ax:startInterview', instruction),
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
  proposeRevision: (workflowId: string, instruction: string) => ipcRenderer.invoke('ax:proposeRevision', workflowId, instruction),
  connectSlack: (payload: string | { token: string; appToken?: string }) =>
    ipcRenderer.invoke('ax:connectSlack', payload),
  connectGmailOAuth: () => ipcRenderer.invoke('ax:connectGmailOAuth'),
  disconnectGmailOAuth: () => ipcRenderer.invoke('ax:disconnectGmailOAuth'),
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
  saveChatSession: (state: unknown, summary?: string, workflowId?: string) =>
    ipcRenderer.invoke('ax:saveChatSession', state, summary, workflowId),
  onAgentProgress: (listener: (event: { message: string }) => void) => {
    const wrapped = (_e: unknown, event: { message: string }) => listener(event);
    ipcRenderer.on('ax:agent-progress', wrapped);
    return () => ipcRenderer.removeListener('ax:agent-progress', wrapped);
  },
  onStateChanged: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on('ax:state-changed', wrapped);
    return () => ipcRenderer.removeListener('ax:state-changed', wrapped);
  },
});
