import type {
  DiscoveryMetadataInput,
  DiscoveryMetadataRecord,
} from '../../contracts/discovery-metadata.js';
import {
  normalizeDiscoveryMetadata,
  normalizeDiscoveryMetadataInput,
} from '../../contracts/discovery-metadata.js';
import type { AppDatabase } from '../db.js';

interface DiscoveryMetadataRow {
  asset_id: string;
  description: string | null;
  aliases_json: string;
  fields_json: string;
  updated_at: string;
}
function parseJsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function recordFromRow(row: DiscoveryMetadataRow): DiscoveryMetadataRecord | undefined {
  return normalizeDiscoveryMetadata({
    assetId: row.asset_id,
    description: row.description ?? undefined,
    aliases: parseJsonArray(row.aliases_json),
    fields: parseJsonArray(row.fields_json),
    updatedAt: row.updated_at,
  });
}

export function getDiscoveryMetadata(
  db: AppDatabase,
  assetId: string,
): DiscoveryMetadataRecord | undefined {
  const row = db.prepare(
    'SELECT asset_id, description, aliases_json, fields_json, updated_at FROM discovery_metadata WHERE asset_id = ?',
  ).get(assetId.trim()) as DiscoveryMetadataRow | undefined;
  return row ? recordFromRow(row) : undefined;
}

export function listDiscoveryMetadata(db: AppDatabase): DiscoveryMetadataRecord[] {
  const rows = db.prepare(
    'SELECT asset_id, description, aliases_json, fields_json, updated_at FROM discovery_metadata ORDER BY asset_id ASC',
  ).all() as unknown as DiscoveryMetadataRow[];
  return rows
    .map(recordFromRow)
    .filter((record): record is DiscoveryMetadataRecord => Boolean(record));
}

export function upsertDiscoveryMetadata(db: AppDatabase, input: DiscoveryMetadataInput): DiscoveryMetadataRecord {
  const record = normalizeDiscoveryMetadataInput(input);
  db.prepare(
    `INSERT INTO discovery_metadata
      (asset_id, description, aliases_json, fields_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET
       description = excluded.description,
       aliases_json = excluded.aliases_json,
       fields_json = excluded.fields_json,
       updated_at = excluded.updated_at`,
  ).run(
    record.assetId,
    record.description ?? null,
    JSON.stringify(record.aliases),
    JSON.stringify(record.fields),
    record.updatedAt,
  );
  return record;
}

export function deleteDiscoveryMetadata(db: AppDatabase, assetId: string): boolean {
  const value = assetId.trim();
  if (!value) return false;
  return db.prepare('DELETE FROM discovery_metadata WHERE asset_id = ?').run(value).changes > 0;
}
