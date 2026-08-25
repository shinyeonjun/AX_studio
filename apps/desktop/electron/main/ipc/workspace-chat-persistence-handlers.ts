import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';
import { normalizeChatMessages } from './chat-boundary.js';

export function registerWorkspaceChatPersistenceHandlers() {
  ipcHandle('ax:listChatSessions', async () => {
    const workspace = getCore().store.listWorkspaceChats(50).map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
      kind: 'workspace' as const,
      workflowId: chat.workflowId,
      sourceCount: chat.sourceCount,
      corrupted: chat.corrupted,
    }));
    return workspace.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  });

  ipcHandle(
    'ax:saveWorkspaceChat',
    async (_event, id: string | undefined, messages: unknown, workflowId?: unknown) => {
      const core = getCore();
      if (id !== undefined && typeof id !== 'string') throw new Error('대화 id 형식이 올바르지 않습니다.');
      if (workflowId !== undefined && workflowId !== null && typeof workflowId !== 'string') {
        throw new Error('workflow id 형식이 올바르지 않습니다.');
      }
      const normalizedWorkflowId =
        workflowId === null
          ? null
          : typeof workflowId === 'string'
            ? workflowId.trim() || null
            : undefined;
      return core.store.saveWorkspaceChat({
        id,
        messages: normalizeChatMessages(messages),
        ...(normalizedWorkflowId === undefined ? {} : { workflowId: normalizedWorkflowId }),
      });
    },
  );

  ipcHandle('ax:loadWorkspaceChat', async (_event, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('대화 id가 필요합니다.');
    const chat = getCore().store.getWorkspaceChat(id);
    if (!chat) throw new Error('대화를 찾을 수 없습니다.');
    return chat;
  });

  ipcHandle('ax:loadWorkspaceChatByWorkflowId', async (_event, workflowId: string) => {
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('workflow id가 필요합니다.');
    return getCore().store.getWorkspaceChatByWorkflowId(workflowId.trim());
  });

  ipcHandle('ax:deleteWorkspaceChat', async (_event, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('대화 id가 필요합니다.');
    const core = getCore();
    core.workspaceSources.removeSession(id);
    core.store.deleteWorkspaceChat(id);
    return { ok: true };
  });
}
