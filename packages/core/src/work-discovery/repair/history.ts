import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { TableArtifactSchema, type TableArtifact } from '../../contracts/artifacts/table.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';

function isWithinRoot(rootDir: string, filePath: string): boolean {
  const root = resolve(rootDir);
  const candidate = resolve(filePath);
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function sessionIdForWorkflow(workflow: WorkflowIR): string | undefined {
  if (workflow.id?.startsWith('discovery_')) return workflow.id.slice('discovery_'.length);
  if (!workflow.document) return undefined;
  try {
    const document = JSON.parse(workflow.document) as Record<string, unknown>;
    return document.origin === 'discovery' && typeof document.sessionId === 'string'
      ? document.sessionId
      : undefined;
  } catch {
    return undefined;
  }
}

export function loadSnapshots(
  store: WorkflowStore,
  sessionId: string,
  exampleId: string,
  snapshotRoot: string,
): { ok: true; snapshots: Record<string, TableArtifact> } | { ok: false; reason: string } {
  const records = store.listDiscoverySnapshots(sessionId).filter((record) => record.exampleId === exampleId);
  if (records.length === 0) return { ok: false, reason: 'historical_snapshot_unavailable' };
  const sessionRoot = resolve(snapshotRoot, sessionId);
  const snapshots: Record<string, TableArtifact> = {};
  for (const record of records) {
    if (!record.manifestPath || !isWithinRoot(sessionRoot, record.manifestPath) || !existsSync(record.manifestPath)) {
      return { ok: false, reason: 'historical_snapshot_unavailable' };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(record.manifestPath, 'utf8')) as unknown;
    } catch {
      return { ok: false, reason: 'historical_snapshot_unavailable' };
    }
    const parsed = TableArtifactSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'historical_snapshot_invalid' };
    snapshots[record.sourceId] = parsed.data;
  }
  return { ok: true, snapshots };
}
