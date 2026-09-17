import { writeSnapshotTable } from '../snapshot-file.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { SourceDescriptor } from '../schema.js';
import type { ExplorationBudget } from './adapters.js';
import {
  rankSourcesForDiscovery,
  type DiscoverySourceDecisionContext,
} from './decision-ranking.js';
import type { DiscoverySourceContext } from '../sources/types.js';
import type { DiscoverySourceRegistry } from '../sources/registry.js';

export interface InventorySnapshot {
  id: string;
  exampleId: string;
  sourceId: string;
  kind: string;
  artifactId?: string;
  manifestPath?: string;
  fingerprint: string;
  queryJson?: string;
  metadataJson?: string;
  table?: TableArtifact;
}

export interface InventoryResult {
  sources: SourceDescriptor[];
  snapshots: InventorySnapshot[];
  budget: ExplorationBudget;
  stoppedReason?: string;
}

export async function inventorySources(
  registry: DiscoverySourceRegistry,
  ctx: DiscoverySourceContext,
  decision: DiscoverySourceDecisionContext = {},
): Promise<InventoryResult> {
  const budget = { ...ctx.budget };
  const descriptors: SourceDescriptor[] = [];
  const snapshots: InventorySnapshot[] = [];

  for (const provider of registry.list()) {
    const listed = await provider.listSources({ ...ctx, budget });
    descriptors.push(...listed);
  }

  const ranked = await rankSourcesForDiscovery(descriptors, ctx.observations, decision);
  for (const source of ranked) {
    if (budget.sourceReadsUsed >= budget.sourceReadsMax) {
      return { sources: ranked, snapshots, budget, stoppedReason: 'budget_exceeded' };
    }
    const provider = registry.forConnector(source.connector);
    if (!provider) continue;
    const profile = await provider.profileSource({ ...ctx, budget }, source.id);
    if (!profile?.table) continue;
    const manifestPath = writeSnapshotTable(ctx.snapshotDir, ctx.exampleId, source.id, profile.table, profile.fingerprint);
    snapshots.push({
      id: `snap_${profile.table.id}`,
      exampleId: ctx.exampleId,
      sourceId: source.id,
      kind: 'table',
      artifactId: profile.table.id,
      manifestPath,
      fingerprint: profile.fingerprint,
      queryJson: profile.queryJson,
      metadataJson: JSON.stringify({ connector: source.connector }),
      table: profile.table,
    });
  }

  return { sources: ranked, snapshots, budget };
}
