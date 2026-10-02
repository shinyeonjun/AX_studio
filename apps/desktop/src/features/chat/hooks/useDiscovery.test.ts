import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stateSetters = vi.hoisted(() => Array.from({ length: 5 }, () => vi.fn()));
const hookState = vi.hoisted(() => ({ setterIndex: 0 }));

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: vi.fn(),
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: (_initial: unknown) => {
    const setter = stateSetters[hookState.setterIndex++];
    if (!setter) throw new Error('Unexpected useState call');
    return [_initial, setter];
  },
}));

import { useDiscovery } from './useDiscovery';
import { createWorkspaceMessageActions } from './workspace-chat/message-actions';
import { createWorkspaceLoadActions } from './workspace-chat/load-actions';
import { transcriptSnapshot } from './workspace-chat/transcript-snapshot';
import { createWorkspaceSourceActions } from './workspace-chat/source-actions';
import { createWorkspaceWorkflowActions } from './workspace-chat/workflow-actions';
import type { WorkspaceChatMessageContext } from './workspace-chat/contracts';
import { createDatabaseAsync, WorkflowStore, type WorkspaceChatMessage, type WorkspaceChatSaveOptions } from '@ax-studio/core';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function workspaceContext(): WorkspaceChatMessageContext {
  const refs: WorkspaceChatMessageContext['refs'] = {
    sessionEpochRef: { current: 0 }, workspaceSessionIdRef: { current: 'A' },
    activeRequestIdRef: { current: undefined }, busyRef: { current: false },
    sourceBusyRef: { current: false }, pendingWorkspaceChatRefreshRef: { current: undefined },
  };
  const ctx: WorkspaceChatMessageContext = {
    refs, chatMessages: [], workspaceWorkflowState: null, workflowRegistered: false,
    refresh: vi.fn().mockResolvedValue(undefined), refreshMappedWorkspaceChat: vi.fn().mockResolvedValue(undefined),
    isCurrentSession: epoch => epoch === refs.sessionEpochRef.current,
    isViewingSession: id => id === refs.workspaceSessionIdRef.current,
    setWorkspaceContextKey: vi.fn(), setWorkspaceSessionId: vi.fn(), setChatMessages: vi.fn(),
    setWorkspaceWorkflowState: vi.fn(), setBusy: vi.fn(), setError: vi.fn(), setProgress: vi.fn(),
    setEditHint: vi.fn(), setWorkflowRegistered: vi.fn(), setWorkspaceSources: vi.fn(), setSourceBusy: vi.fn(),
  };
  return ctx;
}

describe('workspace asynchronous session ordering', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    stateSetters.splice(0, stateSetters.length, vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn());
    hookState.setterIndex = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('serializes inspection while ignoring a superseded operation result', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const discoveryInspect = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        ax: {
          importArtifact: vi.fn().mockResolvedValue({ ok: true, artifact: { id: 'artifact-1' } }),
          discoveryStart: vi.fn().mockResolvedValue({ status: 'ok', data: { sessionId: 'session-1' } }),
          discoveryInspect,
        },
      },
    });

    const { importAndStart } = useDiscovery();
    const firstStart = importAndStart('goal');
    await vi.waitFor(() => expect(discoveryInspect).toHaveBeenCalledOnce());
    const secondStart = importAndStart('goal');
    await Promise.resolve();
    expect(discoveryInspect).toHaveBeenCalledOnce();
    first.resolve({ status: 'ok', data: { status: 'observing', revision: 1 } });
    await vi.waitFor(() => expect(discoveryInspect).toHaveBeenCalledTimes(2));

    const latestView = { status: 'clarifying', revision: 2 };
    second.resolve({ status: 'ok', data: latestView });
    await secondStart;
    expect(stateSetters[2]).toHaveBeenCalledWith(latestView);

    await firstStart;

    expect(stateSetters[2]).toHaveBeenCalledTimes(1);
  });

  it('ignores a completed chat after switching sessions during workflow loading', async () => {
    const pending = deferred<unknown>();
    const workflow = { state: {}, summary: 'A', title: 'A', active: true };
    const loadWorkChat = vi.fn().mockReturnValue(pending.promise);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: {
      saveWorkspaceChat: vi.fn().mockImplementation(async (_id, messages) => ({ id: 'A', messages })),
      sendCommandChat: vi.fn().mockResolvedValue({ content: 'done', changedWorkflowIds: ['workflow-A'] }),
      loadWorkChat,
    } } });
    const ctx = workspaceContext();
    const { refs } = ctx;
    const running = createWorkspaceMessageActions(ctx).sendMessage('Create my report');
    await vi.waitFor(() => expect(loadWorkChat).toHaveBeenCalledOnce());
    refs.sessionEpochRef.current++;
    refs.workspaceSessionIdRef.current = 'B';
    vi.mocked(ctx.setWorkspaceSources).mockClear();
    vi.mocked(ctx.setWorkspaceWorkflowState).mockClear();
    pending.resolve(workflow);
    await running;
    expect(ctx.setWorkspaceSources).not.toHaveBeenCalled();
    expect(ctx.setWorkspaceWorkflowState).not.toHaveBeenCalled();
    expect(ctx.setWorkflowRegistered).not.toHaveBeenCalled();
  });
  it.each([false, true])('refreshes a returned chat after its detached reply, deferring if another request is busy=%s', async (busy) => {
    const pending = deferred<unknown>();
    const sendCommandChat = vi.fn().mockReturnValue(pending.promise);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: {
      saveWorkspaceChat: vi.fn().mockImplementation(async (_id, messages) => ({ id: 'A', messages })),
      sendCommandChat,
    } } });
    const ctx = workspaceContext();
    const running = createWorkspaceMessageActions(ctx).sendMessage('Send the test after approval');
    await vi.waitFor(() => expect(sendCommandChat).toHaveBeenCalledOnce());
    expect(sendCommandChat).toHaveBeenCalledWith(
      'Send the test after approval',
      expect.any(String),
      undefined,
      'A',
    );
    // Leave A and reopen it while the original request is still running.
    ctx.refs.sessionEpochRef.current += 2;
    ctx.refs.activeRequestIdRef.current = busy ? 'new-request' : undefined;
    ctx.refs.busyRef.current = busy;
    vi.mocked(ctx.setChatMessages).mockClear();
    pending.resolve({ content: 'Ready for approval' });
    await running;
    expect(ctx.setChatMessages).not.toHaveBeenCalled();
    if (busy) {
      expect(ctx.refreshMappedWorkspaceChat).not.toHaveBeenCalled();
      expect(ctx.refs.pendingWorkspaceChatRefreshRef.current).toBe('A');
    } else {
      expect(ctx.refreshMappedWorkspaceChat).toHaveBeenCalledWith('A');
    }
  });

  it('keeps a late attachment from changing the new session or releasing its attachment lock', async () => {
    const pending = deferred<unknown>();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: {
      attachWorkspaceSource: vi.fn().mockReturnValue(pending.promise),
      listWorkspaceSources: vi.fn().mockResolvedValue({ sources: [] }),
    } } });
    const ctx = workspaceContext();
    const running = createWorkspaceSourceActions(ctx).attachWorkspaceSource();
    ctx.refs.sessionEpochRef.current++;
    ctx.refs.workspaceSessionIdRef.current = 'B';
    ctx.refs.sourceBusyRef.current = true;
    vi.mocked(ctx.setSourceBusy).mockClear();
    pending.resolve({ ok: true, sessionId: 'A', source: { id: 'source-A' } });
    await running;
    expect(ctx.refs.workspaceSessionIdRef.current).toBe('B');
    expect(ctx.refs.sourceBusyRef.current).toBe(true);
    expect(ctx.setWorkspaceSessionId).not.toHaveBeenCalled();
    expect(ctx.setWorkspaceSources).not.toHaveBeenCalled();
    expect(ctx.setSourceBusy).not.toHaveBeenCalled();
  });

  it('rejects a delayed ordinary reply snapshot after metadata B, a background result and a newer turn', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const empty = store.saveWorkspaceChat({ messages: [] });
      const pending = deferred<unknown>();
      const sendCommandChat = vi.fn().mockReturnValue(pending.promise);
      const saveWorkspaceChat = vi.fn(async (id: string | undefined, messages: WorkspaceChatMessage[], workflowId?: string | null, options?: WorkspaceChatSaveOptions) =>
        store.saveWorkspaceChat({ id, messages, workflowId, expectedTranscriptRevision: options?.expectedTranscriptRevision }));
      const loadWorkspaceChat = vi.fn(async (id: string) => store.getWorkspaceChat(id)!);
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: { saveWorkspaceChat, sendCommandChat, loadWorkspaceChat } } });
      const ctx = workspaceContext();
      ctx.refs.workspaceSessionIdRef.current = empty.id;
      ctx.refs.transcriptRevisionRef = { current: empty.transcriptRevision };
      const running = createWorkspaceMessageActions(ctx).sendMessage('Repeated identical text');
      await vi.waitFor(() => expect(sendCommandChat).toHaveBeenCalledOnce());
      const a = store.getWorkspaceChat(empty.id)!;
      const b = store.saveWorkspaceChat({ id: a.id, messages: [...a.messages, { role: 'user', content: 'Repeated identical text', turnId: 'metadata-b' }],
        expectedTranscriptRevision: a.transcriptRevision, registeredMetadataParticipation: true });
      store.appendWorkspaceChatMetadataReply({ sessionId: b.id, turnId: 'metadata-b', userText: 'Repeated identical text', reply: 'Stored B metadata',
        expectedTranscriptRevision: b.transcriptRevision!, assertCurrent: () => undefined });
      store.upsertWorkspaceChatExecutionResult(b.id, { role: 'assistant', content: 'Background result', kind: 'execution_result', executionId: 'background' });
      const afterBackground = store.getWorkspaceChat(b.id)!;
      const authoritative = store.saveWorkspaceChat({ id: b.id, messages: [...afterBackground.messages, { role: 'user', content: 'New user turn', turnId: 'new-turn' }],
        expectedTranscriptRevision: afterBackground.transcriptRevision });
      ctx.refs.transcriptRevisionRef.current = authoritative.transcriptRevision;
      pending.resolve({ content: 'Late ordinary A' });
      await running;
      expect(sendCommandChat).toHaveBeenCalledOnce(); expect(saveWorkspaceChat).toHaveBeenCalledTimes(2);
      expect(saveWorkspaceChat.mock.calls[1]?.[3]?.expectedTranscriptRevision).toBe(a.transcriptRevision);
      expect(store.getWorkspaceChat(b.id)).toEqual(authoritative);
      expect(ctx.setChatMessages).toHaveBeenLastCalledWith(authoritative.messages);
      expect(ctx.setError).toHaveBeenCalledWith(expect.stringContaining('오래된 저장을 거부'));
      expect(authoritative.messages.filter(message => message.role === 'user')).toHaveLength(3);
    } finally { db.close?.(); }
  });

  it('keeps unsaved new text for review after a stale initial snapshot without dispatch or retry', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const old = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'A', turnId: 'turn-a' }] });
      const current = store.saveWorkspaceChat({ id: old.id, messages: [...old.messages, { role: 'user', content: 'B', turnId: 'turn-b' }],
        expectedTranscriptRevision: old.transcriptRevision, registeredMetadataParticipation: true });
      const sendCommandChat = vi.fn();
      const saveWorkspaceChat = vi.fn(async (id: string, messages: WorkspaceChatMessage[], _workflowId: unknown, options?: WorkspaceChatSaveOptions) =>
        store.saveWorkspaceChat({ id, messages, expectedTranscriptRevision: options?.expectedTranscriptRevision }));
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: {
        saveWorkspaceChat, sendCommandChat, loadWorkspaceChat: async (id: string) => store.getWorkspaceChat(id),
      } } });
      const ctx = workspaceContext();
      ctx.refs.workspaceSessionIdRef.current = old.id;
      ctx.refs.transcriptRevisionRef = { current: old.transcriptRevision };
      ctx.chatMessages = old.messages;
      await createWorkspaceMessageActions(ctx).sendMessage('Unsaved text for review');
      expect(sendCommandChat).not.toHaveBeenCalled(); expect(saveWorkspaceChat).toHaveBeenCalledOnce();
      expect(ctx.setEditHint).toHaveBeenCalledWith('Unsaved text for review');
      expect(ctx.setChatMessages).toHaveBeenLastCalledWith(current.messages);
      expect(ctx.refs.transcriptRevisionRef.current).toBe(current.transcriptRevision);
      expect(store.getWorkspaceChat(old.id)).toEqual(current);
    } finally { db.close?.(); }
  });

  it('consumes a matching main-persisted metadata receipt without replacing its transcript', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const empty = store.saveWorkspaceChat({ messages: [] });
      const saveWorkspaceChat = vi.fn(async (id: string, messages: WorkspaceChatMessage[], _workflowId: unknown, options?: WorkspaceChatSaveOptions) =>
        store.saveWorkspaceChat({ id, messages, expectedTranscriptRevision: options?.expectedTranscriptRevision,
          registeredMetadataParticipation: options?.metadataLane === 'registered_http_metadata' }));
      const sendCommandChat = vi.fn(async (text: string, requestId: string, _workflow: unknown, sessionId: string) => {
        const before = store.getWorkspaceChat(sessionId)!;
        const saved = store.appendWorkspaceChatMetadataReply({ sessionId, turnId: requestId, userText: text, reply: 'Main-approved saved facts',
          expectedTranscriptRevision: before.transcriptRevision!, assertCurrent: () => undefined });
        return { requestId, content: 'Main-approved saved facts', metadataStop: 'answered',
          persistedReply: { kind: 'registered_http_metadata', requestId, sessionId, turnId: requestId,
            requestGeneration: 1, transcriptRevision: saved.transcriptRevision } };
      });
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: { saveWorkspaceChat, sendCommandChat,
        loadWorkspaceChat: async (id: string) => store.getWorkspaceChat(id) } } });
      const ctx = workspaceContext();
      ctx.refs.workspaceSessionIdRef.current = empty.id;
      ctx.refs.transcriptRevisionRef = { current: empty.transcriptRevision };
      await createWorkspaceMessageActions(ctx).sendMessage('Saved metadata', { metadataLane: 'registered_http_metadata' });
      expect(saveWorkspaceChat).toHaveBeenCalledOnce(); expect(sendCommandChat).toHaveBeenCalledOnce();
      const saved = store.getWorkspaceChat(empty.id)!;
      expect(saved.messages.map(message => message.content)).toEqual(['Saved metadata', 'Main-approved saved facts']);
      expect(ctx.setChatMessages).toHaveBeenLastCalledWith(saved.messages);
      expect(ctx.refs.transcriptRevisionRef.current).toBe(saved.transcriptRevision);
    } finally { db.close?.(); }
  });

  it.each(['refresh', 'conflict-reload', 'newer-user'] as const)('keeps a retained render snapshot paired with its own token after %s', async mode => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const b = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Metadata B', turnId: 'metadata-b' }], registeredMetadataParticipation: true });
      const ctx = workspaceContext();
      ctx.refs.workspaceSessionIdRef.current = b.id;
      ctx.refs.transcriptRevisionRef = { current: b.transcriptRevision };
      ctx.chatMessages = b.messages;
      ctx.transcriptSnapshot = transcriptSnapshot(b.messages, b.transcriptRevision);
      ctx.setTranscriptSnapshot = vi.fn();
      const retained = createWorkspaceMessageActions(ctx);
      const answered = store.appendWorkspaceChatMetadataReply({ sessionId: b.id, turnId: 'metadata-b', userText: 'Metadata B',
        reply: 'Approved B inventory', expectedTranscriptRevision: b.transcriptRevision!, assertCurrent: () => undefined });
      const current = mode === 'newer-user' ? store.saveWorkspaceChat({ id: b.id, messages: [...answered.messages,
        { role: 'user', content: 'New ordinary C', turnId: 'ordinary-c' }], expectedTranscriptRevision: answered.transcriptRevision }) : answered;
      const save = vi.fn(async (id: string, messages: WorkspaceChatMessage[], _workflowId: unknown, options?: WorkspaceChatSaveOptions) =>
        store.saveWorkspaceChat({ id, messages, expectedTranscriptRevision: options?.expectedTranscriptRevision }));
      const send = vi.fn(async (_text: string, requestId: string) => ({ content: 'Ordinary D reply', requestId }));
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: { saveWorkspaceChat: save, sendCommandChat: send,
        loadWorkspaceChat: async (id: string) => store.getWorkspaceChat(id)! } } });
      if (mode === 'conflict-reload') await retained.sendMessage('Unsaved D');
      else await createWorkspaceLoadActions(ctx).refreshMappedWorkspaceChat(b.id);
      expect(ctx.refs.transcriptRevisionRef.current).toBe(current.transcriptRevision);
      expect(ctx.setTranscriptSnapshot).toHaveBeenLastCalledWith({ messages: current.messages, transcriptRevision: current.transcriptRevision });
      // Even a callback created after the ref advances must use the old render's
      // complete state pair, while React's replacement render is still pending.
      await createWorkspaceMessageActions(ctx).sendMessage('Unsaved D');
      await retained.sendMessage('Unsaved D');
      expect(send).not.toHaveBeenCalled();
      for (const call of save.mock.calls) expect(call[3]?.expectedTranscriptRevision).toBe(b.transcriptRevision);
      expect(store.getWorkspaceChat(b.id)).toEqual(current);
      expect(ctx.setEditHint).toHaveBeenCalledWith('Unsaved D');
      // A genuinely current render can append once without losing B or C.
      ctx.chatMessages = current.messages;
      ctx.transcriptSnapshot = transcriptSnapshot(current.messages, current.transcriptRevision);
      await createWorkspaceMessageActions(ctx).sendMessage('Current D');
      expect(send).toHaveBeenCalledOnce();
      const final = store.getWorkspaceChat(b.id)!;
      expect(final.messages).toContainEqual({ role: 'assistant', content: 'Approved B inventory' });
      if (mode === 'newer-user') expect(final.messages).toContainEqual({ role: 'user', content: 'New ordinary C', turnId: 'ordinary-c' });
      expect(final.messages.filter(message => message.role === 'user' && message.content === 'Current D')).toHaveLength(1);
    } finally { db.close?.(); }
  });

  it('does not borrow a fresh ref token for a speculative snapshot that has no persisted revision', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const b = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'Metadata B', turnId: 'metadata-b' }], registeredMetadataParticipation: true });
      const answered = store.appendWorkspaceChatMetadataReply({ sessionId: b.id, turnId: 'metadata-b', userText: 'Metadata B',
        reply: 'Approved B inventory', expectedTranscriptRevision: b.transcriptRevision!, assertCurrent: () => undefined });
      const ctx = workspaceContext();
      ctx.refs.workspaceSessionIdRef.current = b.id;
      ctx.refs.transcriptRevisionRef = { current: answered.transcriptRevision };
      ctx.chatMessages = b.messages;
      ctx.transcriptSnapshot = transcriptSnapshot(b.messages);
      const save = vi.fn(async (id: string, messages: WorkspaceChatMessage[], _workflow: unknown, options?: WorkspaceChatSaveOptions) =>
        store.saveWorkspaceChat({ id, messages, expectedTranscriptRevision: options?.expectedTranscriptRevision }));
      const send = vi.fn();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: { saveWorkspaceChat: save, sendCommandChat: send,
        loadWorkspaceChat: async (id: string) => store.getWorkspaceChat(id)! } } });
      await createWorkspaceMessageActions(ctx).sendMessage('Unsaved D');
      expect(save).toHaveBeenCalledOnce(); expect(save.mock.calls[0]?.[3]).toBeUndefined();
      expect(send).not.toHaveBeenCalled(); expect(store.getWorkspaceChat(b.id)).toEqual(answered);
      expect(ctx.setEditHint).toHaveBeenCalledWith('Unsaved D');
    } finally { db.close?.(); }
  });

  it('does not mark the new session registered when an old workflow activation finishes', async () => {
    const pending = deferred<unknown>();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { ax: {
      setWorkflowActive: vi.fn().mockReturnValue(pending.promise),
    } } });
    const ctx = workspaceContext();
    ctx.workspaceWorkflowState = { workflowId: 'workflow-A' };
    const running = createWorkspaceWorkflowActions(ctx).registerWorkflow();
    ctx.refs.sessionEpochRef.current++;
    ctx.refs.workspaceSessionIdRef.current = 'B';
    pending.resolve({ ok: true });
    await running;
    expect(ctx.setWorkflowRegistered).not.toHaveBeenCalled();
    expect(ctx.refresh).toHaveBeenCalledOnce();
  });

});
