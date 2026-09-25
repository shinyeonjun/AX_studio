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
import { createWorkspaceSourceActions } from './workspace-chat/source-actions';
import { createWorkspaceWorkflowActions } from './workspace-chat/workflow-actions';
import type { WorkspaceChatMessageContext } from './workspace-chat/contracts';

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
