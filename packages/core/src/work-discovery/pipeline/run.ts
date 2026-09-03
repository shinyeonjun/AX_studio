import { join } from 'node:path';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { DiscoverySessionState } from '../schema.js';
import { inventorySources } from '../exploration/inventory.js';
import type { DiscoveryPipelineExample, DiscoveryPipelineHost } from './contracts.js';
import { completeDiscoveryReplay } from './replay.js';

export type { DiscoveryPipelineHost } from './contracts.js';

export async function runDiscoveryPipeline(host: DiscoveryPipelineHost, sessionId: string): Promise<void> {
  if (host.running.has(sessionId)) return;
  host.running.add(sessionId);
  const started = Date.now();

  let state = host.store.getDiscoverySessionState(sessionId);
  if (!state || state.status === 'cancelled') {
    host.running.delete(sessionId);
    return;
  }

  const examples: DiscoveryPipelineExample[] = host.store.listDiscoveryExamples(sessionId);
  let observations = state.observations;
  let snapshotsByExample: Record<string, Record<string, TableArtifact>> = {};
  let sourceInventory: DiscoverySessionState['sourceInventory'] = state.sourceInventory;
  let sourceReadsUsed = state.budgets.sourceReadsUsed;
  const persistedSnapshots = host.loadPersistedSnapshotTables(state, examples.map((example) => example.id));
  const checkpointStatus = state.status === 'synthesizing' || state.status === 'validating';
  if (checkpointStatus && persistedSnapshots === undefined) {
    throw new Error('discovery_checkpoint_unavailable');
  }
  const resumeFromCheckpoint = checkpointStatus && persistedSnapshots !== undefined;

  if (resumeFromCheckpoint) {
    snapshotsByExample = persistedSnapshots;
  } else {
    if (state.status !== 'collecting_examples') {
      state = host.resetForRecovery(state);
      observations = [];
      sourceInventory = [];
      sourceReadsUsed = 0;
    }

    state = host.transition(state, 'observing_output');
    for (const example of examples) {
      if (host.isCancelled(sessionId)) return;
      for (const artifactId of example.outputArtifactIds) {
        observations.push(...host.observeOutputArtifact(example.id, artifactId));
      }
    }
    state = host.patchState(sessionId, { observations });

    state = host.transition(state, 'inventory_sources');
    state = host.transition(state, 'exploring_sources');

    const allSources = new Map<string, DiscoverySessionState['sourceInventory'][number]>();
    for (const example of examples) {
      if (host.isCancelled(sessionId)) return;
      const inventory = await inventorySources(host.sourceRegistry, {
        store: host.store,
        artifactStore: host.artifactStore,
        resolveConnectionConfig: host.resolveConnectionConfig,
        snapshotDir: join(host.snapshotDir, sessionId),
        exampleId: example.id,
        observations,
        inputArtifactIds: example.inputArtifactIds,
        budget: {
          sourceReadsUsed,
          sourceReadsMax: state.budgets.sourceReadsMax,
        },
      });
      sourceReadsUsed = inventory.budget.sourceReadsUsed;
      for (const source of inventory.sources) allSources.set(source.id, source);
      for (const snapshot of inventory.snapshots) {
        host.store.upsertDiscoverySnapshot({
          id: host.snapshotRecordId(sessionId, snapshot.exampleId, snapshot.sourceId),
          sessionId,
          exampleId: snapshot.exampleId,
          sourceId: snapshot.sourceId,
          kind: snapshot.kind,
          artifactId: snapshot.artifactId,
          manifestPath: snapshot.manifestPath,
          fingerprint: snapshot.fingerprint,
          queryJson: snapshot.queryJson,
          metadataJson: snapshot.metadataJson,
          capturedAt: new Date().toISOString(),
        });
        if (snapshot.table) {
          snapshotsByExample[snapshot.exampleId] ??= {};
          snapshotsByExample[snapshot.exampleId]![snapshot.sourceId] = snapshot.table;
        }
      }
      if (inventory.stoppedReason) break;
    }

    sourceInventory = [...allSources.values()].map((source) => {
      if (source.connector !== 'input_artifact') return source;
      const artifactId = String(source.metadata?.artifactId ?? source.id.replace(/^input:/, ''));
      const stored = host.artifactStore.get(artifactId);
      if (!stored) return source;
      return {
        ...source,
        metadata: { ...source.metadata, artifactId, storedPath: stored.storedPath },
      };
    });

    state = host.patchState(sessionId, {
      sourceInventory,
      budgets: {
        ...state.budgets,
        sourceReadsUsed,
      },
    });

    if (host.isCancelled(sessionId)) return;

    state = host.transition(state, 'synthesizing');
  }
  completeDiscoveryReplay({
    host,
    sessionId,
    examples,
    state,
    observations,
    sourceInventory,
    snapshotsByExample,
    startedAt: started,
  });
  host.running.delete(sessionId);
}
