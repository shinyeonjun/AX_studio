import { observeArtifact } from '../../observation/observe-artifact.js';
import type { DiscoveryRecoveryCheckpoint, DiscoverySessionState } from '../../schema.js';
import { assertTransition } from '../../state-machine.js';
import { AUTO_RESUME_STATUSES } from '../../view.js';
import type {
  WorkDiscoveryRuntime,
  WorkDiscoveryRuntimeOptions,
} from '../contracts.js';

export interface DiscoveryLifecycleStateOperations extends Pick<
  WorkDiscoveryRuntime,
  'resetForRecovery' | 'transition' | 'patchState' | 'isCancelled' | 'observeOutputArtifact'
> {
  markNeedsAttention: (
    state: DiscoverySessionState,
    errorCode: string,
    errorMessage: string,
  ) => DiscoverySessionState;
}

export function createDiscoveryLifecycleStateOperations(
  options: WorkDiscoveryRuntimeOptions,
  running: Set<string>,
): DiscoveryLifecycleStateOperations {
  const resetForRecovery = (state: DiscoverySessionState): DiscoverySessionState => {
    const next: DiscoverySessionState = {
      ...state,
      status: 'collecting_examples',
      revision: state.revision + 1,
      sourceInventory: [],
      observations: [],
      candidates: [],
      pendingQuestion: undefined,
      blueprint: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      budgets: {
        ...state.budgets,
        sourceReadsUsed: 0,
        elapsedMs: 0,
        stoppedReason: undefined,
      },
      updatedAt: new Date().toISOString(),
    };
    options.store.saveDiscoverySession(next);
    return next;
  };

  const markNeedsAttention = (
    state: DiscoverySessionState,
    errorCode: string,
    errorMessage: string,
  ): DiscoverySessionState => {
    const next: DiscoverySessionState = {
      ...state,
      status: 'needs_attention',
      recoveryCheckpoint: state.recoveryCheckpoint ?? (AUTO_RESUME_STATUSES.has(state.status)
        ? state.status as DiscoveryRecoveryCheckpoint
        : undefined),
      revision: state.revision + 1,
      errorCode,
      errorMessage,
      updatedAt: new Date().toISOString(),
    };
    options.store.saveDiscoverySession(next);
    return next;
  };

  const observeOutputArtifact = (exampleId: string, artifactId: string) =>
    observeArtifact(
      exampleId,
      artifactId,
      options.artifactStore,
      options.materializeWorkbook,
    );

  const isCancelled = (sessionId: string): boolean => {
    const state = options.store.getDiscoverySessionState(sessionId);
    if (!state) return true;
    if (state.status === 'cancelled') {
      running.delete(sessionId);
      return true;
    }
    return false;
  };

  const transition = (
    state: DiscoverySessionState,
    to: DiscoverySessionState['status'],
  ): DiscoverySessionState => {
    assertTransition(state.status, to);
    const next = {
      ...state,
      status: to,
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    options.store.saveDiscoverySession(next);
    return next;
  };

  const patchState = (
    sessionId: string,
    patch: Partial<DiscoverySessionState>,
  ): DiscoverySessionState => {
    const state = options.store.getDiscoverySessionState(sessionId);
    if (!state) throw new Error('session_not_found');
    const next = {
      ...state,
      ...patch,
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    options.store.saveDiscoverySession(next);
    return next;
  };

  return {
    resetForRecovery,
    markNeedsAttention,
    transition,
    patchState,
    isCancelled,
    observeOutputArtifact,
  };
}
