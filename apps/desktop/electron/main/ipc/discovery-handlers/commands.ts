import { AGENT_COMMAND_CONTEXT } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';

const MAX_WORKSPACE_SESSION_ID_LENGTH = 200;

function objectArgs(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
}

/**
 * Splits the optional originating workspace chat id off the command args. When the
 * renderer supplies it, core binds (start) or scopes (all other commands) the discovery
 * session to that chat; the binding is persisted so it survives restarts.
 */
export function splitWorkspaceSession(payload: unknown): {
  args: Record<string, unknown>;
  workspaceSessionId?: string;
} {
  const { workspaceSessionId, ...args } = objectArgs(payload);
  const id = typeof workspaceSessionId === 'string' ? workspaceSessionId.trim() : '';
  return id && id.length <= MAX_WORKSPACE_SESSION_ID_LENGTH
    ? { args, workspaceSessionId: id }
    : { args };
}

/** inspect/cancel historically take a bare session id; an object payload may add the chat id. */
function sessionPayload(payload: unknown): { args: Record<string, unknown>; workspaceSessionId?: string } {
  if (payload && typeof payload === 'object') return splitWorkspaceSession(payload);
  return { args: { sessionId: payload } };
}

function executeDiscovery(
  name: 'discovery.start' | 'discovery.inspect' | 'discovery.cancel' | 'discovery.retry' | 'discovery.answer' | 'discovery.publish',
  split: { args: Record<string, unknown>; workspaceSessionId?: string },
  agent: boolean,
) {
  return getCore().commandService.execute({ name, args: split.args }, {
    ...(agent ? { executionContext: AGENT_COMMAND_CONTEXT } : {}),
    ...(split.workspaceSessionId ? { workspaceSessionId: split.workspaceSessionId } : {}),
  });
}

/** Waiting on the person: still worth finishing after the app was closed. */
const RESUMABLE_DISCOVERY_STATUSES = new Set(['needs_clarification', 'ready_to_publish', 'needs_attention']);

/**
 * Discoveries started from "지난 결과물 첨부하기" belong to no chat, so after a restart nothing
 * showed them again. Only those (a chat's own discoveries reopen with that chat), newest first.
 */
export function resumableDiscoveries(store: ReturnType<typeof getCore>['store']) {
  return store.listDiscoverySessions()
    .filter((session) => RESUMABLE_DISCOVERY_STATUSES.has(session.status) && !store.getDiscoverySessionWorkspace(session.id))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5)
    .map((session) => ({ sessionId: session.id, goal: session.userGoal, status: session.status, updatedAt: session.updatedAt }));
}

export function registerDiscoveryCommandHandlers(): void {
  ipcHandle('ax:discoveryResumable', async () => resumableDiscoveries(getCore().store));

  ipcHandle('ax:discoveryStart', async (_event, payload: unknown) =>
    executeDiscovery('discovery.start', splitWorkspaceSession(payload), true));

  ipcHandle('ax:discoveryInspect', async (_event, payload: unknown) =>
    executeDiscovery('discovery.inspect', sessionPayload(payload), false));

  ipcHandle('ax:discoveryCancel', async (_event, payload: unknown) =>
    executeDiscovery('discovery.cancel', sessionPayload(payload), true));

  ipcHandle('ax:discoveryRetry', async (_event, payload: unknown) =>
    executeDiscovery('discovery.retry', splitWorkspaceSession(payload), true));

  ipcHandle('ax:discoveryAnswer', async (_event, payload: unknown) =>
    executeDiscovery('discovery.answer', splitWorkspaceSession(payload), true));

  ipcHandle('ax:discoveryPublish', async (_event, payload: unknown) => {
    const result = await executeDiscovery('discovery.publish', splitWorkspaceSession(payload), true);
    // Publishing saves a workflow; the work list must show it without a restart.
    notifyStateChanged();
    return result;
  });
}
