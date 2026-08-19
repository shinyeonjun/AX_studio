import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ax', {
  getState: () => ipcRenderer.invoke('ax:getState'),
  startInterview: (instruction: string) => ipcRenderer.invoke('ax:startInterview', instruction),
  applyAnswer: (state: unknown, answer: string) => ipcRenderer.invoke('ax:applyAnswer', state, answer),
  saveSkill: (ir: unknown) => ipcRenderer.invoke('ax:saveSkill', ir),
  runSkill: (skillId: string) => ipcRenderer.invoke('ax:runSkill', skillId),
  runEphemeral: (ir: unknown) => ipcRenderer.invoke('ax:runEphemeral', ir),
  approve: (id: string) => ipcRenderer.invoke('ax:approve', id),
  reject: (id: string) => ipcRenderer.invoke('ax:reject', id),
  deleteSkill: (skillId: string) => ipcRenderer.invoke('ax:deleteSkill', skillId),
  setGlobalActive: (active: boolean) => ipcRenderer.invoke('ax:setGlobalActive', active),
  setSkillActive: (skillId: string, active: boolean) => ipcRenderer.invoke('ax:setSkillActive', skillId, active),
  explain: (q: string) => ipcRenderer.invoke('ax:explain', q),
  proposeRevision: (skillId: string, instruction: string) => ipcRenderer.invoke('ax:proposeRevision', skillId, instruction),
  connectSlack: (token: string) => ipcRenderer.invoke('ax:connectSlack', token),
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
  loadSkillChat: (skillId: string) => ipcRenderer.invoke('ax:loadSkillChat', skillId),
  saveChatSession: (state: unknown, summary?: string, skillId?: string) =>
    ipcRenderer.invoke('ax:saveChatSession', state, summary, skillId),
  onAgentProgress: (listener: (event: { message: string }) => void) => {
    const wrapped = (_e: unknown, event: { message: string }) => listener(event);
    ipcRenderer.on('ax:agent-progress', wrapped);
    return () => ipcRenderer.removeListener('ax:agent-progress', wrapped);
  },
});
