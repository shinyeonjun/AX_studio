import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';
import { rankSources, type ExplorationBudget } from '../exploration/adapters.js';
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
): Promise<InventoryResult> {
  const budget = { ...ctx.budget };
  const descriptors: SourceDescriptor[] = [];
  const snapshots: InventorySnapshot[] = [];

  for (const provider of registry.list()) {
    const listed = await provider.listSources({ ...ctx, budget });
    descriptors.push(...listed);
  }

  const ranked = rankSources(descriptors, ctx.observations);
  for (const source of ranked) {
    if (budget.sourceReadsUsed >= budget.sourceReadsMax) {
      return { sources: ranked, snapshots, budget, stoppedReason: 'budget_exceeded' };
    }
    const provider = registry.forConnector(source.connector);
    if (!provider) continue;
    const profile = await provider.profileSource({ ...ctx, budget }, source.id);
    if (!profile?.table) continue;
    mkdirSync(ctx.snapshotDir, { recursive: true });
    const manifestPath = join(ctx.snapshotDir, `${profile.table.id}.json`);
    writeFileSync(manifestPath, JSON.stringify(profile.table));
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
