import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceChatMessage } from '@ax-studio/core';
import type { WorkspaceChatMessageContext } from './contracts';
import { createWorkspaceMessageActions } from './message-actions';

afterEach(() => vi.unstubAllGlobals());

describe('workspace chat message actions', () => {
  it('does not reload workspace sources after a normal chat response', async () => {
    const listWorkspaceSources = vi.fn(async () => ({ sources: [] }));
    const saveWorkspaceChat = vi.fn(async (id: string | undefined, messages: { role: 'user' | 'assistant'; content: string }[]) => ({
      id: id ?? 'chat-1',
      messages,
      updatedAt: new Date(0).toISOString(),
    }));
    vi.stubGlobal('window', {
      ax: {
        saveWorkspaceChat,
        sendCommandChat: vi.fn(async () => ({ role: 'assistant', content: '응답' })),
        listWorkspaceSources,
      },
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' });

    const context = {
      refs: {
        sessionEpochRef: { current: 1 },
        workspaceSessionIdRef: { current: 'chat-1' },
        activeRequestIdRef: { current: undefined },
        busyRef: { current: false },
        sourceBusyRef: { current: false },
        pendingWorkspaceChatRefreshRef: { current: undefined },
      },
      chatMessages: [],
      workspaceWorkflowState: null,
      refresh: vi.fn(async () => undefined),
      onSessionsChanged: vi.fn(),
      isCurrentSession: () => true,
      isViewingSession: () => true,
      setWorkspaceContextKey: vi.fn(),
      setWorkspaceSessionId: vi.fn(),
      setChatMessages: vi.fn(),
      setWorkspaceWorkflowState: vi.fn(),
      setBusy: vi.fn(),
      setError: vi.fn(),
      setProgress: vi.fn(),
      setEditHint: vi.fn(),
      setWorkflowRegistered: vi.fn(),
      workflowRegistered: false,
      setWorkspaceSources: vi.fn(),
      setSourceBusy: vi.fn(),
      refreshMappedWorkspaceChat: vi.fn(async () => undefined),
    } satisfies WorkspaceChatMessageContext;

    await createWorkspaceMessageActions(context).sendMessage('질문');

    expect(saveWorkspaceChat).toHaveBeenCalledTimes(2);
    expect(listWorkspaceSources).not.toHaveBeenCalled();
  });

  it('keeps a received reply visible and warns against duplicate execution when final transcript save fails', async () => {
    const savedMessages: WorkspaceChatMessage[][] = [];
    const saveWorkspaceChat = vi.fn()
      .mockResolvedValueOnce({ id: 'chat-1', messages: [], updatedAt: new Date(0).toISOString() })
      .mockRejectedValueOnce(new Error('workspace_chat_too_large'));
    const sendCommandChat = vi.fn(async () => ({ role: 'assistant', content: '전송 완료' }));
    const setChatMessages: WorkspaceChatMessageContext['setChatMessages'] = vi.fn((value) => {
      savedMessages.push(typeof value === 'function' ? value([]) : value);
    });
    const setError = vi.fn();
    vi.stubGlobal('window', {
      ax: { saveWorkspaceChat, sendCommandChat },
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' });

    const context = {
      refs: {
        sessionEpochRef: { current: 1 },
        workspaceSessionIdRef: { current: 'chat-1' },
        activeRequestIdRef: { current: undefined },
        busyRef: { current: false },
        sourceBusyRef: { current: false },
        pendingWorkspaceChatRefreshRef: { current: undefined },
      },
      chatMessages: [],
      workspaceWorkflowState: null,
      refresh: vi.fn(async () => undefined),
      isCurrentSession: () => true,
      isViewingSession: () => true,
      setWorkspaceContextKey: vi.fn(),
      setWorkspaceSessionId: vi.fn(),
      setChatMessages,
      setWorkspaceWorkflowState: vi.fn(),
      setBusy: vi.fn(),
      setError,
      setProgress: vi.fn(),
      setEditHint: vi.fn(),
      setWorkflowRegistered: vi.fn(),
      workflowRegistered: false,
      setWorkspaceSources: vi.fn(),
      setSourceBusy: vi.fn(),
      refreshMappedWorkspaceChat: vi.fn(async () => undefined),
    } satisfies WorkspaceChatMessageContext;

    await createWorkspaceMessageActions(context).sendMessage('테스트 채널에 보내줘');

    expect(sendCommandChat).toHaveBeenCalledTimes(1);
    expect(savedMessages.at(-1)).toContainEqual({ role: 'assistant', content: '전송 완료' });
    expect(setError).toHaveBeenCalledWith(expect.stringContaining('외부 작업 요청이었다면 이미 실행됐을 수 있으니'));
  });
});
