import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import { buildTableArtifact } from '../../modules/local-sheet/profile.js';
import { openReadonlySqlite } from '../../store/db.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';
import {
  rankSources,
  type DiscoverySourceAdapter,
  type ExplorationBudget,
  type SourceProfileResult,
} from './adapters.js';

export interface InventoryOptions {
  rdb?: {
    filePath: string;
    allowedTables: string[];
    rowLimit?: number;
  };
  localSheets?: Array<{ path: string; label: string }>;
  snapshotDir: string;
  budget: ExplorationBudget;
}

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

class RdbDiscoveryAdapter implements DiscoverySourceAdapter {
  connector = 'rdb';

  constructor(private readonly config: NonNullable<InventoryOptions['rdb']>) {}

  async listSources(): Promise<SourceDescriptor[]> {
    const db = await openReadonlySqlite(this.config.filePath);
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    db.close();
    return tables
      .map((row) => String(row.name))
      .filter((name) => this.config.allowedTables.includes(name))
      .map((name) => ({
        id: `rdb:${name}`,
        connector: 'rdb',
        label: name,
        kind: 'table' as const,
        relevance: 0,
        profileSummary: `sqlite table ${name}`,
      }));
  }

  async profileSource(sourceId: string, budget: ExplorationBudget): Promise<SourceProfileResult | null> {
    if (budget.sourceReadsUsed >= budget.sourceReadsMax) return null;
    const table = sourceId.replace(/^rdb:/, '');
    if (!this.config.allowedTables.includes(table)) return null;
    const db = await openReadonlySqlite(this.config.filePath);
    const rows = db.all(`SELECT * FROM ${table} LIMIT ${this.config.rowLimit ?? 200}`);
    db.close();
    budget.sourceReadsUsed += 1;
    const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
    const matrix = rows.map((row) => headers.map((header) => (row as Record<string, unknown>)[header]));
    const artifact = buildTableArtifact({
      id: `snap_${createHash('sha256').update(`${sourceId}:${rows.length}`).digest('hex').slice(0, 16)}`,
      name: table,
      headers,
      matrix,
      rowLimit: this.config.rowLimit ?? 200,
      source: { table, database: this.config.filePath },
    });
    return {
      descriptor: {
        id: sourceId,
        connector: 'rdb',
        label: table,
        kind: 'table',
        relevance: 0,
        profileSummary: headers.join(', '),
      },
      table: artifact,
      fingerprint: createHash('sha256').update(JSON.stringify({ table, rowCount: rows.length })).digest('hex'),
    };
  }
}

class LocalSheetDiscoveryAdapter implements DiscoverySourceAdapter {
  connector = 'local_sheet';

  constructor(private readonly sheets: NonNullable<InventoryOptions['localSheets']>) {}

  async listSources(): Promise<SourceDescriptor[]> {
    return this.sheets.map((sheet) => ({
      id: `sheet:${sheet.path}`,
      connector: 'local_sheet',
      label: sheet.label,
      kind: 'workbook',
      relevance: 0,
      profileSummary: sheet.path,
    }));
  }

  async profileSource(sourceId: string, budget: ExplorationBudget): Promise<SourceProfileResult | null> {
    if (budget.sourceReadsUsed >= budget.sourceReadsMax) return null;
    const path = sourceId.replace(/^sheet:/, '');
    const sheet = this.sheets.find((entry) => entry.path === path);
    if (!sheet) return null;
    const { readSheetFromPath } = await import('../../modules/local-sheet/read.js');
    const table = readSheetFromPath({ path });
    budget.sourceReadsUsed += 1;
    return {
      descriptor: {
        id: sourceId,
        connector: 'local_sheet',
        label: sheet.label,
        kind: 'workbook',
        relevance: 0,
        profileSummary: table.columns.map((column) => column.name).join(', '),
      },
      table,
      fingerprint: createHash('sha256').update(JSON.stringify({ path, rowCount: table.rows.length })).digest('hex'),
    };
  }
}

export function createDiscoveryAdapters(options: InventoryOptions): DiscoverySourceAdapter[] {
  const adapters: DiscoverySourceAdapter[] = [];
  if (options.rdb) adapters.push(new RdbDiscoveryAdapter(options.rdb));
  if (options.localSheets?.length) adapters.push(new LocalSheetDiscoveryAdapter(options.localSheets));
  return adapters;
}

export async function inventorySources(
  exampleId: string,
  observations: OutputObservation[],
  options: InventoryOptions,
): Promise<InventoryResult> {
  mkdirSync(options.snapshotDir, { recursive: true });
  const adapters = createDiscoveryAdapters(options);
  const budget = { ...options.budget };
  const descriptors: SourceDescriptor[] = [];
  const snapshots: InventorySnapshot[] = [];

  for (const adapter of adapters) {
    const sources = await adapter.listSources();
    descriptors.push(...sources);
  }

  const ranked = rankSources(descriptors, observations);
  for (const source of ranked) {
    if (budget.sourceReadsUsed >= budget.sourceReadsMax) {
      return {
        sources: ranked,
        snapshots,
        budget,
        stoppedReason: 'budget_exceeded',
      };
    }
    const adapter = adapters.find((entry) => entry.connector === source.connector);
    if (!adapter) continue;
    const profile = await adapter.profileSource(source.id, budget);
    if (!profile?.table) continue;
    const manifestPath = join(options.snapshotDir, `${profile.table.id}.json`);
    writeFileSync(manifestPath, JSON.stringify(profile.table));
    snapshots.push({
      id: `snap_${profile.table.id}`,
      exampleId,
      sourceId: source.id,
      kind: 'table',
      artifactId: profile.table.id,
      manifestPath,
      fingerprint: profile.fingerprint,
      queryJson: JSON.stringify({ sourceId: source.id }),
      metadataJson: JSON.stringify({ connector: source.connector }),
      table: profile.table,
    });
  }

  return { sources: ranked, snapshots, budget };
}
