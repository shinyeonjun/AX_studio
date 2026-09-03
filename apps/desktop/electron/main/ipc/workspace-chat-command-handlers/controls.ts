import { explainExecution } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { cancelWorkspaceChat } from '../../workspace-chat-registry.js';

export function registerWorkspaceChatControlHandlers() {
  ipcHandle('ax:cancelChat', async (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || !requestId.trim()) return { ok: false };
    return { ok: cancelWorkspaceChat(requestId.trim()) };
  });

  ipcHandle('ax:explain', async (_event, question: unknown) => {
    if (typeof question !== 'string' || !question.trim()) throw new Error('설명할 질문을 입력해 주세요.');
    return explainExecution(getCore().store, question);
  });
}
