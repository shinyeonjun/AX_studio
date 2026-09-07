import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../../db.js';
import type { DiscoveryExampleRecord } from './contracts.js';
import { parseArtifactIds } from './parsing.js';

export function insertDiscoveryExample(
  db: AppDatabase,
  params: {
    sessionId: string;
    label?: string;
    outputArtifactIds: string[];
    inputArtifactIds: string[];
    observationsJson?: string;
  },
): DiscoveryExampleRecord {
  const record: DiscoveryExampleRecord = {
    id: `ex_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    sessionId: params.sessionId,
    label: params.label,
    outputArtifactIds: params.outputArtifactIds,
    inputArtifactIds: params.inputArtifactIds,
    observationsJson: params.observationsJson ?? '[]',
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO work_discovery_examples
      (id, session_id, label, output_artifact_ids_json, input_artifact_ids_json, observations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.sessionId,
    record.label ?? null,
    JSON.stringify(record.outputArtifactIds),
    JSON.stringify(record.inputArtifactIds),
    record.observationsJson,
    record.createdAt,
  );
  return record;
}

export function listDiscoveryExamples(db: AppDatabase, sessionId: string): DiscoveryExampleRecord[] {
  const rows = db.prepare(
    'SELECT * FROM work_discovery_examples WHERE session_id = ? ORDER BY created_at ASC',
  ).all(sessionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    label: row.label ? String(row.label) : undefined,
    outputArtifactIds: parseArtifactIds(row.output_artifact_ids_json, String(row.id), 'output_artifact_ids'),
    inputArtifactIds: parseArtifactIds(row.input_artifact_ids_json, String(row.id), 'input_artifact_ids'),
    observationsJson: String(row.observations_json),
    createdAt: String(row.created_at),
  }));
}
