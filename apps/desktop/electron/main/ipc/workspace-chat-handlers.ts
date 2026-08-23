import { ipcHandle } from './ipc-handle.js';
import {
  buildWorkflowView,
  explainExecution,
  runAxCommandChat,
  AX_COMMAND_CHAT_TIMEOUT_MS,
  summarizeWorkflow,
  type WorkspaceExecutionMode,
} from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { connectedConnectorIds } from './shared.js';
import { normalizeChatMessages, requireLastUserMessage } from './chat-boundary.js';
import { buildDesktopDesignToolContext } from './design-tool-context.js';
import {
  cancelWorkspaceChat,
  registerWorkspaceChat,
  releaseWorkspaceChat,
} from '../workspace-chat-registry.js';

function parseWorkspaceExecutionMode(value: unknown): WorkspaceExecutionMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'once' && value !== 'workflow') {
    throw new Error('대화 실행 모드가 올바르지 않습니다.');
  }
  return value;
}

export function registerWorkspaceChatHandlers() {
  ipcHandle('ax:loadWorkChat', async (_e, workflowId: string) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    const ir = core.store.getWorkflow(workflowId.trim());
    if (!ir) throw new Error('Workflow not found');
    const state = buildWorkflowView(ir, workflowId.trim());
    const summary = summarizeWorkflow(state.draft);
    return { state, summary, title: ir.name };
  });

  ipcHandle('ax:sendCommandChat', async (
    event,
    messages: unknown,
    requestId?: unknown,
    workflowId?: unknown,
    executionMode?: unknown,
  ) => {
    const core = getCore();
    const normalizedMessages = normalizeChatMessages(messages);
    if (normalizedMessages.length === 0) {
      throw new Error('대화 기록이 필요합니다.');
    }
    const userMessage = requireLastUserMessage(normalizedMessages);
    const history = normalizedMessages.slice(0, -1);
    if (workflowId !== undefined && (typeof workflowId !== 'string' || !workflowId.trim())) {
      throw new Error('workflow id 형식이 올바르지 않습니다.');
    }
    const parsedExecutionMode = parseWorkspaceExecutionMode(executionMode);
    const chatRequestId =
      typeof requestId === 'string' && requestId.trim() ? requestId.trim() : `command-chat-${Date.now()}`;
    const controller = registerWorkspaceChat(chatRequestId);
    const changedWorkflowIds = new Set<string>();
    const removedWorkflowIds = new Set<string>();
    try {
      const reply = await runAxCommandChat({
        harness: core.agentHarness,
        commandService: core.commandService,
        connectedConnectors: connectedConnectorIds(core.store),
        messages: history,
        userMessage,
        currentWorkflowId: typeof workflowId === 'string' ? workflowId.trim() : undefined,
        executionMode: parsedExecutionMode,
        designToolContext: buildDesktopDesignToolContext(
          core,
          core.store.getConnections(),
          connectedConnectorIds(core.store),
          parsedExecutionMode ? 'authoring' : 'plain_chat',
        ),
        abortSignal: controller.signal,
        timeoutMs: AX_COMMAND_CHAT_TIMEOUT_MS,
        onCommandResult: (result) => {
          if (result.command === 'workflow.delete') {
            const data = result.data;
            if (data && typeof data === 'object' && !Array.isArray(data)) {
              const workflowId = (data as { workflowId?: unknown }).workflowId;
              if (typeof workflowId === 'string' && workflowId.trim()) removedWorkflowIds.add(workflowId);
            }
            return;
          }
          if (!['workflow.create', 'workflow.update'].includes(result.command)) return;
          const data = result.data;
          if (!data || typeof data !== 'object' || Array.isArray(data)) return;
          const workflowId = (data as { workflowId?: unknown }).workflowId;
          if (typeof workflowId === 'string' && workflowId.trim()) changedWorkflowIds.add(workflowId);
        },
        onProgress: ({ message }) => {
          event.sender.send('ax:chat-progress', { message, requestId: chatRequestId });
        },
      });
      return {
        role: 'assistant' as const,
        content: reply,
        requestId: chatRequestId,
        changedWorkflowIds: [...changedWorkflowIds],
        removedWorkflowIds: [...removedWorkflowIds],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : String(error);
      throw new Error(message && message !== '{' ? message : '명령형 채팅 AI 호출에 실패했습니다. AI 연결을 확인하세요.');
    } finally {
      releaseWorkspaceChat(chatRequestId);
    }
  });

  ipcHandle('ax:cancelChat', async (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || !requestId.trim()) {
      return { ok: false };
    }
    return { ok: cancelWorkspaceChat(requestId.trim()) };
  });

  ipcHandle('ax:listChatSessions', async () => {
    const core = getCore();
    const workspace = core.store.listWorkspaceChats(50).map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
      kind: 'workspace' as const,
      workflowId: chat.workflowId,
      executionMode: chat.executionMode,
      corrupted: chat.corrupted,
    }));
    return workspace.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  });

  ipcHandle(
    'ax:saveWorkspaceChat',
    async (_e, id: string | undefined, messages: unknown, workflowId?: unknown, executionMode?: unknown) => {
      const core = getCore();
      if (id !== undefined && typeof id !== 'string') throw new Error('대화 id 형식이 올바르지 않습니다.');
      if (workflowId !== undefined && typeof workflowId !== 'string') {
        throw new Error('workflow id 형식이 올바르지 않습니다.');
      }
      return core.store.saveWorkspaceChat({
        id,
        messages: normalizeChatMessages(messages),
        workflowId: workflowId?.trim() || undefined,
        executionMode: parseWorkspaceExecutionMode(executionMode),
      });
    },
  );

  ipcHandle('ax:loadWorkspaceChat', async (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('대화 id가 필요합니다.');
    const chat = getCore().store.getWorkspaceChat(id);
    if (!chat) throw new Error('대화를 찾을 수 없습니다.');
    return chat;
  });

  ipcHandle('ax:loadWorkspaceChatByWorkflowId', async (_e, workflowId: string) => {
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('workflow id가 필요합니다.');
    return getCore().store.getWorkspaceChatByWorkflowId(workflowId.trim());
  });

  ipcHandle('ax:deleteWorkspaceChat', async (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('대화 id가 필요합니다.');
    getCore().store.deleteWorkspaceChat(id);
    return { ok: true };
  });

  ipcHandle('ax:explain', async (_e, question: unknown) => {
    if (typeof question !== 'string' || !question.trim()) throw new Error('설명할 질문을 입력해 주세요.');
    return explainExecution(getCore().store, question);
  });

}
