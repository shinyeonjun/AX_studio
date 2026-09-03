import { loadPersistedSnapshotTables, snapshotRecordId } from '../../snapshot.js';
import { runDiscoveryPipeline } from '../../pipeline.js';
import { AUTO_RESUME_STATUSES } from '../../view.js';
import type { DiscoveryRecoveryCheckpoint } from '../../schema.js';
import type { WorkDiscoveryRuntimeOptions } from '../contracts.js';
import type { DiscoveryLifecycleStateOperations } from './state.js';

export interface DiscoveryLifecycleRunner {
  scheduleRun: (sessionId: string) => void;
  resumePendingSessions: () => void;
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

  const scheduleRun = (sessionId: string): void => {
    setImmediate(() => {
      void runPipeline(sessionId).catch((error) => {
        const state = options.store.getDiscoverySessionState(sessionId);
        if (!state || state.status === 'cancelled') {
          running.delete(sessionId);
          return;
        }
        const automaticRecovery = (state.autoRecoveryAttempts ?? 0) > 0;
        state.status = automaticRecovery ? 'needs_attention' : 'failed';
        state.revision += 1;
        state.errorCode = automaticRecovery ? 'discovery_recovery_failed' : 'pipeline_failed';
        state.errorMessage = automaticRecovery
          ? 'Automatic recovery stopped: ' + (error instanceof Error ? error.message : String(error))
          : error instanceof Error ? error.message : String(error);
        state.updatedAt = new Date().toISOString();
        options.store.saveDiscoverySession(state);
        running.delete(sessionId);
      });
    });
  };

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
