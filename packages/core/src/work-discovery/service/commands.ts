import { randomUUID } from 'node:crypto';
import { applyClarificationAnswer } from '../clarification/answer-apply.js';
import {
  DiscoveryCancelArgsSchema,
  DiscoveryStartArgsSchema,
  type DiscoverySessionState,
  type DiscoveryStartArgs,
} from '../schema.js';
import { isTerminalStatus } from '../state-machine.js';
import type { DiscoveryRevisionConflict, WorkDiscoveryRuntime } from './contracts.js';

export function startDiscovery(
  runtime: WorkDiscoveryRuntime,
  args: DiscoveryStartArgs,
): { id: string; state: DiscoverySessionState['status'] } {
  const parsed = DiscoveryStartArgsSchema.parse(args);
  const now = new Date().toISOString();
  const sessionId = 'wd_' + randomUUID().replace(/-/g, '').slice(0, 16);
  const exampleIds: string[] = [];
  const sessionInputArtifactIds = parsed.inputArtifactIds ?? [];

  const state: DiscoverySessionState = {
    id: sessionId,
    status: 'collecting_examples',
    revision: 0,
    userGoal: parsed.goal,
    exampleIds,
    desiredRecurrence: parsed.desiredRecurrence,
    sourceInventory: [],
    observations: [],
    candidates: [],
    budgets: {
      sourceReadsUsed: 0,
      sourceReadsMax: runtime.sourceReadsMax,
      elapsedMs: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  runtime.store.saveDiscoverySession(state);

  for (const [index, artifactId] of parsed.exampleArtifactIds.entries()) {
    const example = runtime.store.insertDiscoveryExample({
      sessionId,
      label: 'example_' + (index + 1),
      outputArtifactIds: [artifactId],
      inputArtifactIds: sessionInputArtifactIds,
    });
    exampleIds.push(example.id);
  }

  state.exampleIds = exampleIds;
  state.revision += 1;
  runtime.store.saveDiscoverySession(state);
  runtime.scheduleRun(sessionId);
  return { id: sessionId, state: state.status };
}

export async function waitForTerminal(
  runtime: WorkDiscoveryRuntime,
  sessionId: string,
  timeoutMs = 15_000,
): Promise<DiscoverySessionState | undefined> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = runtime.store.getDiscoverySessionState(sessionId);
    if (!state) return undefined;
    if (isTerminalStatus(state.status) && !runtime.running.has(sessionId)) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return runtime.store.getDiscoverySessionState(sessionId);
}

export function cancelDiscovery(
  runtime: WorkDiscoveryRuntime,
  sessionId: string,
): DiscoverySessionState | undefined {
  const parsed = DiscoveryCancelArgsSchema.parse({ sessionId });
  const state = runtime.store.getDiscoverySessionState(parsed.sessionId);
  if (!state || isTerminalStatus(state.status)) return undefined;
  state.status = 'cancelled';
  state.revision += 1;
  state.updatedAt = new Date().toISOString();
  runtime.store.saveDiscoverySession(state);
  runtime.running.delete(parsed.sessionId);
  return state;
}

export function retryDiscovery(
  runtime: WorkDiscoveryRuntime,
  sessionId: string,
  expectedRevision: number,
): DiscoverySessionState | DiscoveryRevisionConflict | { error: string } {
  const state = runtime.store.getDiscoverySessionState(sessionId);
  if (!state) return { error: 'discovery_not_found' };
  if (state.revision !== expectedRevision) {
    return { error: 'discovery_revision_conflict', currentRevision: state.revision };
  }
  if (state.status !== 'needs_attention') return { error: 'discovery_not_needs_attention' };
  const checkpoint = state.recoveryCheckpoint;
  if (!checkpoint) return { error: 'discovery_checkpoint_missing' };

  let next: DiscoverySessionState;
  if (checkpoint === 'synthesizing' || checkpoint === 'validating') {
    next = {
      ...state,
      status: checkpoint,
      revision: state.revision + 1,
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: new Date().toISOString(),
    };
    runtime.store.saveDiscoverySession(next);
  } else {
    next = runtime.resetForRecovery(state);
  }
  runtime.scheduleRun(sessionId);
  return next;
}

export function answerDiscovery(
  runtime: WorkDiscoveryRuntime,
  sessionId: string,
  questionId: string,
  optionId: string,
  expectedRevision?: number,
): DiscoverySessionState | DiscoveryRevisionConflict | undefined {
  const state = runtime.store.getDiscoverySessionState(sessionId);
  if (state && expectedRevision !== undefined && state.revision !== expectedRevision) {
    return { error: 'discovery_revision_conflict', currentRevision: state.revision };
  }
  if (!state?.pendingQuestion || state.pendingQuestion.id !== questionId) return undefined;
  const next = applyClarificationAnswer(state, state.pendingQuestion, optionId);
  runtime.store.saveDiscoverySession(next);
  return next;
}
