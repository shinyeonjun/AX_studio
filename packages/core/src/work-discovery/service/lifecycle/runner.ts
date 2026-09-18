import { loadPersistedSnapshotTables, snapshotRecordId } from '../../snapshot.js';
import { runDiscoveryPipeline } from '../../pipeline.js';
import {
  decideDiscoveryRecovery,
  DISCOVERY_RECOVERY_MAX_ATTEMPTS,
  DISCOVERY_RECOVERY_SOURCE_READ_CAP,
} from '../../recovery/decision-controller.js';
import { DiscoveryRecoverableError } from '../../recovery/error.js';
import { AUTO_RESUME_STATUSES } from '../../view.js';
import type {
  DiscoveryRecoveryCheckpoint,
  DiscoverySessionState,
} from '../../schema.js';
import type { WorkDiscoveryRuntimeOptions } from '../contracts.js';
import type { DiscoveryLifecycleStateOperations } from './state.js';

export interface DiscoveryLifecycleRunner {
  scheduleRun: (sessionId: string) => void;
  resumePendingSessions: () => void;
}

function checkpointFor(state: DiscoverySessionState): DiscoveryRecoveryCheckpoint | undefined {
  if (AUTO_RESUME_STATUSES.has(state.status)) return state.status as DiscoveryRecoveryCheckpoint;
  return state.recoveryCheckpoint;
}

export function createDiscoveryLifecycleRunner(
  options: WorkDiscoveryRuntimeOptions,
  running: Set<string>,
  stateOperations: DiscoveryLifecycleStateOperations,
): DiscoveryLifecycleRunner {
  const runPipeline = (sessionId: string): Promise<void> =>
    runDiscoveryPipeline({
      store: options.store,
      artifactStore: options.artifactStore,
      decisionEngine: options.decisionEngine,
      sourceRegistry: options.sourceRegistry,
      snapshotDir: options.snapshotDir,
      materializeWorkbook: options.materializeWorkbook,
      resolveConnectionConfig: options.resolveConnectionConfig,
      running,
      loadPersistedSnapshotTables: (state, exampleIds) =>
        loadPersistedSnapshotTables(options.store, state, exampleIds),
      snapshotRecordId,
      resetForRecovery: stateOperations.resetForRecovery,
      transition: stateOperations.transition,
      patchState: stateOperations.patchState,
      isCancelled: stateOperations.isCancelled,
      observeOutputArtifact: stateOperations.observeOutputArtifact,
    }, sessionId);

  const persistFailed = (
    state: DiscoverySessionState,
    errorCode: string,
    errorMessage: string,
  ): DiscoverySessionState => {
    const next: DiscoverySessionState = {
      ...state,
      status: 'failed',
      revision: state.revision + 1,
      errorCode,
      errorMessage,
      updatedAt: new Date().toISOString(),
    };
    options.store.saveDiscoverySession(next);
    return next;
  };

  const prepareRetry = (
    state: DiscoverySessionState,
    checkpoint: DiscoveryRecoveryCheckpoint,
  ): DiscoverySessionState => {
    const attempts = (state.autoRecoveryAttempts ?? 0) + 1;
    if (checkpoint === 'synthesizing' || checkpoint === 'validating') {
      const next: DiscoverySessionState = {
        ...state,
        status: checkpoint,
        autoRecoveryAttempts: attempts,
        recoveryCheckpoint: checkpoint,
        revision: state.revision + 1,
        errorCode: undefined,
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      };
      options.store.saveDiscoverySession(next);
      return next;
    }

    return stateOperations.resetForRecovery({
      ...state,
      autoRecoveryAttempts: attempts,
      recoveryCheckpoint: checkpoint,
    });
  };

  const prepareExpandedSearch = (
    state: DiscoverySessionState,
    checkpoint: DiscoveryRecoveryCheckpoint | undefined,
  ): DiscoverySessionState => {
    const nextMax = Math.min(
      state.budgets.sourceReadsMax + 6,
      DISCOVERY_RECOVERY_SOURCE_READ_CAP,
    );
    return stateOperations.resetForRecovery({
      ...state,
      autoRecoveryAttempts: (state.autoRecoveryAttempts ?? 0) + 1,
      recoveryCheckpoint: checkpoint ?? 'exploring_sources',
      budgets: {
        ...state.budgets,
        sourceReadsMax: nextMax,
      },
    });
  };

  const handleFailure = async (sessionId: string, error: unknown): Promise<void> => {
    let state = options.store.getDiscoverySessionState(sessionId);
    if (!state || state.status === 'cancelled') {
      running.delete(sessionId);
      return;
    }

    const errorCode = error instanceof DiscoveryRecoverableError ? error.code : 'pipeline_failed';
    const errorMessage = error instanceof Error ? error.message : String(error);
    const checkpoint = checkpointFor(state);
    const attempts = state.autoRecoveryAttempts ?? 0;
    running.delete(sessionId);

    // Preserve the pre-Jev behavior exactly when no decision plane is configured.
    if (!options.decisionEngine) {
      if (attempts > 0) {
        stateOperations.markNeedsAttention(
          state,
          'discovery_recovery_failed',
          'Automatic recovery stopped: ' + errorMessage,
        );
      } else {
        persistFailed(state, errorCode, errorMessage);
      }
      return;
    }

    if (attempts >= DISCOVERY_RECOVERY_MAX_ATTEMPTS) {
      stateOperations.markNeedsAttention(
        state,
        'discovery_recovery_exhausted',
        'Automatic recovery reached its attempt limit: ' + errorMessage,
      );
      return;
    }

    const decision = await decideDiscoveryRecovery({
      decisionEngine: options.decisionEngine,
      userGoal: state.userGoal,
      checkpoint,
      errorCode,
      errorMessage,
      autoRecoveryAttempts: attempts,
      budgets: state.budgets,
      sourceInventory: state.sourceInventory,
    });

    state = options.store.getDiscoverySessionState(sessionId);
    if (!state || state.status === 'cancelled') return;

    if (decision.action === 'stop') {
      persistFailed(state, errorCode, errorMessage);
      return;
    }

    if (decision.action === 'ask_human') {
      stateOperations.markNeedsAttention(
        state,
        decision.reason === 'attempt_limit' ? 'discovery_recovery_exhausted' : 'discovery_recovery_needs_attention',
        'Automatic recovery paused: ' + errorMessage,
      );
      return;
    }

    if (decision.action === 'retry_checkpoint') {
      if (!checkpoint) {
        stateOperations.markNeedsAttention(
          state,
          'discovery_checkpoint_missing',
          'Automatic recovery could not find a safe checkpoint.',
        );
        return;
      }
      const next = prepareRetry(state, checkpoint);
      scheduleRun(next.id);
      return;
    }

    const next = prepareExpandedSearch(state, checkpoint);
    scheduleRun(next.id);
  };

  const runScheduled = async (sessionId: string): Promise<void> => {
    try {
      await runPipeline(sessionId);
    } catch (error) {
      await handleFailure(sessionId, error);
    }
  };

  function scheduleRun(sessionId: string): void {
    setImmediate(() => {
      void runScheduled(sessionId).catch((error) => {
        const state = options.store.getDiscoverySessionState(sessionId);
        if (!state || state.status === 'cancelled') {
          running.delete(sessionId);
          return;
        }
        running.delete(sessionId);
        persistFailed(
          state,
          'discovery_recovery_controller_failed',
          error instanceof Error ? error.message : String(error),
        );
      });
    });
  }

  const resumePendingSessions = (): void => {
    for (const state of options.store.listDiscoverySessions()) {
      if (!AUTO_RESUME_STATUSES.has(state.status)) continue;
      if ((state.autoRecoveryAttempts ?? 0) > 0) {
        stateOperations.markNeedsAttention(
          state,
          'discovery_recovery_exhausted',
          'Automatic recovery has already been attempted.',
        );
        continue;
      }
      const next = {
        ...state,
        autoRecoveryAttempts: 1,
        recoveryCheckpoint: state.status as DiscoveryRecoveryCheckpoint,
        revision: state.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      options.store.saveDiscoverySession(next);
      scheduleRun(next.id);
    }
  };

  return { scheduleRun, resumePendingSessions };
}
