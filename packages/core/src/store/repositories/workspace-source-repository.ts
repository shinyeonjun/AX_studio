import type { AppDatabase } from '../db.js';

export type WorkspaceSourceStatus = 'processing' | 'ready' | 'failed';

export interface WorkspaceSourceSummary {
  pageCount: number;
  chunkCount: number;
  tableCount: number;
  imageCount: number;
  visualPageCount: number;
  visualPages: number[];
  ocrPageCount?: number;
  ocrPages?: number[];
  engine: string;
}

export interface WorkspaceSourceRecord {
  id: string;
  sessionId: string;
  artifactId: string;
  fileName: string;
  mimeType?: string;
  status: WorkspaceSourceStatus;
  engine?: string;
  documentArtifactId?: string;
  summary?: WorkspaceSourceSummary;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

function parseSummary(value: unknown): WorkspaceSourceSummary | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const isCount = (candidate: unknown) => Number.isInteger(candidate) && Number(candidate) >= 0;
    const isPageList = (candidate: unknown) => Array.isArray(candidate) && candidate.every(isCount);
    if (
      !isCount(parsed.pageCount)
      || !isCount(parsed.chunkCount)
      || !isCount(parsed.tableCount)
      || !isCount(parsed.imageCount)
      || !isCount(parsed.visualPageCount)
      || !isPageList(parsed.visualPages)
      || typeof parsed.engine !== 'string'
      || (parsed.ocrPageCount !== undefined && !isCount(parsed.ocrPageCount))
      || (parsed.ocrPages !== undefined && !isPageList(parsed.ocrPages))
    ) return undefined;
    return parsed as unknown as WorkspaceSourceSummary;
  } catch {
    return undefined;
  }
}

function toRecord(row: Record<string, unknown>): WorkspaceSourceRecord {
  const status = String(row.status) as WorkspaceSourceStatus;
  if (status !== 'processing' && status !== 'ready' && status !== 'failed') {
    throw new Error(`invalid_workspace_source_status:${status}`);
  }
  const optional = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  const summary = parseSummary(row.summary_json);
  return {
    id: String(row.id),
    sessionId: String(row.chat_id),
    artifactId: String(row.artifact_id),
    fileName: String(row.file_name),
    ...(optional(row.mime_type) ? { mimeType: optional(row.mime_type) } : {}),
    status,
    ...(optional(row.engine) ? { engine: optional(row.engine) } : {}),
    ...(optional(row.document_artifact_id) ? { documentArtifactId: optional(row.document_artifact_id) } : {}),
    ...(summary ? { summary } : {}),
    ...(optional(row.error_code) ? { errorCode: optional(row.error_code) } : {}),
    ...(optional(row.error_message) ? { errorMessage: optional(row.error_message) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function insertWorkspaceSource(
  db: AppDatabase,
  record: WorkspaceSourceRecord,
): WorkspaceSourceRecord {
  db.prepare(
    `INSERT INTO workspace_chat_sources
      (id, chat_id, artifact_id, file_name, mime_type, status, engine, document_artifact_id,
       summary_json, error_code, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.sessionId,
    record.artifactId,
    record.fileName,
    record.mimeType,
    record.status,
    record.engine,
    record.documentArtifactId,
    record.summary ? JSON.stringify(record.summary) : undefined,
    record.errorCode,
    record.errorMessage,
    record.createdAt,
    record.updatedAt,
  );
  return record;
}

export function updateWorkspaceSource(
  db: AppDatabase,
  id: string,
  patch: Partial<Omit<WorkspaceSourceRecord, 'id' | 'sessionId' | 'artifactId' | 'fileName' | 'createdAt'>>,
): WorkspaceSourceRecord | null {
  const current = getWorkspaceSourceById(db, id);
  if (!current) return null;
  const next: WorkspaceSourceRecord = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  db.prepare(
    `UPDATE workspace_chat_sources SET
      mime_type = ?, status = ?, engine = ?, document_artifact_id = ?, summary_json = ?,
      error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`,
  ).run(
    next.mimeType,
    next.status,
    next.engine,
    next.documentArtifactId,
    next.summary ? JSON.stringify(next.summary) : undefined,
    next.errorCode,
    next.errorMessage,
    next.updatedAt,
    id,
  );
  return next;
}

export function getWorkspaceSource(db: AppDatabase, sessionId: string, id: string): WorkspaceSourceRecord | null {
  const row = db.prepare(
    'SELECT * FROM workspace_chat_sources WHERE chat_id = ? AND id = ?',
  ).get(sessionId, id);
  return row ? toRecord(row) : null;
}

export function getWorkspaceSourceById(db: AppDatabase, id: string): WorkspaceSourceRecord | null {
  const row = db.prepare('SELECT * FROM workspace_chat_sources WHERE id = ?').get(id);
  return row ? toRecord(row) : null;
}

export function listWorkspaceSources(db: AppDatabase, sessionId: string): WorkspaceSourceRecord[] {
  return db.prepare(
    'SELECT * FROM workspace_chat_sources WHERE chat_id = ? ORDER BY created_at ASC',
  ).all(sessionId).map(toRecord);
}

/** How many sources outside the given session still reference this artifact. */
export function countWorkspaceSourcesForArtifact(
  db: AppDatabase,
  artifactId: string,
  excludeSessionId: string,
): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM workspace_chat_sources WHERE (artifact_id = ? OR document_artifact_id = ?) AND chat_id != ?',
  ).get(artifactId, artifactId, excludeSessionId) as { n?: number } | undefined;
  return Number(row?.n) || 0;
}
