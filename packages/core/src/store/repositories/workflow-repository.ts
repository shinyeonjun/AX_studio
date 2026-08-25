import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { parseWorkflowIR } from '../../workflow/schema.js';
import { parseStoredWorkflow, serializeWorkflowForStorage } from '../../workflow/persisted-document.js';
import { validateWorkflowForPersistence } from '../../workflow/contract-validator.js';
import {
  type AgentScopedContextMap,
  type AgentScopedContextPatch,
  mergeAgentScopedContext,
  parseStoredAgentScopedContext,
} from '../../agent/scoped-context.js';
import * as settingsRepo from './settings-repository.js';

export function saveWorkflow(db: AppDatabase, ir: WorkflowIR): { workflowId: string; version: number } {
  const now = new Date().toISOString();
  const normalized = parseWorkflowIR(ir);
  const contractIssues = validateWorkflowForPersistence(normalized);
  if (contractIssues.length > 0) {
    const first = contractIssues[0]!;
    throw Object.assign(new Error(first.message), {
      code: 'workflow_validation_failed',
      issues: contractIssues,
    });
  }
  const workflowId = normalized.id ?? randomUUID();
  const existing = db.prepare('SELECT id FROM workflows WHERE id = ?').get(workflowId) as { id: string } | undefined;
  const latest = db
    .prepare('SELECT MAX(version) AS version FROM workflow_versions WHERE workflow_id = ?')
    .get(workflowId) as { version?: number | null } | undefined;
  const version = existing
    ? Math.max(normalized.version, Number(latest?.version ?? 0) + 1)
    : normalized.version;

  db.exec('BEGIN');
  try {
    if (!existing) {
      db
        .prepare('INSERT INTO workflows (id, name, active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
        .run(workflowId, normalized.name, now, now);
    } else {
      db
        .prepare('UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?')
        .run(normalized.name, now, workflowId);
    }

    const versionId = randomUUID();
    const irWithId = { ...normalized, id: workflowId, version };
    db
      .prepare('INSERT INTO workflow_versions (id, workflow_id, version, ir_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(versionId, workflowId, version, serializeWorkflowForStorage(irWithId), now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { workflowId, version };
}

export function getWorkflow(db: AppDatabase, workflowId: string, version?: number): WorkflowIR | null {
  const versions = db
    .prepare('SELECT version, ir_json FROM workflow_versions WHERE workflow_id = ?')
    .all(workflowId) as Array<{ version: number; ir_json: string }>;

  if (versions.length === 0) return null;
  const target = version
    ? versions.find((v) => v.version === version)
    : versions.sort((a, b) => b.version - a.version)[0];
  if (!target) return null;
  try {
    return parseStoredWorkflow(JSON.parse(target.ir_json));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(
      new Error(`워크플로우 ${workflowId} 버전 ${target.version}의 JSON이 손상되었거나 계약에 맞지 않습니다: ${detail}`),
      { code: 'invalid_workflow_json', workflowId, version: target.version },
    );
  }
}

export function getWorkflowPolicy(db: AppDatabase, workflowId: string): AgentScopedContextMap {
  const row = db.prepare('SELECT policy_json FROM workflows WHERE id = ?').get(workflowId) as
    | { policy_json?: string | null }
    | undefined;
  return parseStoredAgentScopedContext(row?.policy_json);
}

export function updateWorkflowPolicy(
  db: AppDatabase,
  workflowId: string,
  patch: AgentScopedContextPatch,
): AgentScopedContextMap | null {
  const row = db.prepare('SELECT id, policy_json FROM workflows WHERE id = ?').get(workflowId) as
    | { id: string; policy_json?: string | null }
    | undefined;
  if (!row) return null;
  const next = mergeAgentScopedContext(parseStoredAgentScopedContext(row.policy_json), patch);
  db.prepare('UPDATE workflows SET policy_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(next), new Date().toISOString(), workflowId);
  return next;
}

export function listWorkflows(db: AppDatabase): Array<{ id: string; name: string; active: boolean; latestVersion: number }> {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.active, COALESCE(MAX(sv.version), 0) AS latestVersion
       FROM workflows s
       LEFT JOIN workflow_versions sv ON sv.workflow_id = s.id
       GROUP BY s.id, s.name, s.active`,
    )
    .all() as Array<{ id: string; name: string; active: number; latestVersion: number }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    active: Boolean(row.active),
    latestVersion: row.latestVersion ?? 0,
  }));
}

export function setWorkflowActive(db: AppDatabase, workflowId: string, active: boolean): boolean {
  db.prepare('UPDATE workflows SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, new Date().toISOString(), workflowId);
  const row = db.prepare('SELECT changes() AS count').get() as { count?: number } | undefined;
  return Number(row?.count ?? 0) === 1;
}

// Settings blobs keyed by workflow id that must not outlive the workflow.
// Owners: runtime/scheduler.ts (lastFired) and triggers/types.ts (cursors).
const WORKFLOW_KEYED_SETTINGS = ['scheduler.lastFired', 'trigger.cursors'];

function pruneWorkflowKeyedSettings(db: AppDatabase, workflowId: string): void {
  for (const key of WORKFLOW_KEYED_SETTINGS) {
    const value = settingsRepo.getSetting<Record<string, unknown>>(db, key, {});
    if (!value || typeof value !== 'object' || !(workflowId in value)) continue;
    const { [workflowId]: _removed, ...rest } = value;
    settingsRepo.setSetting(db, key, rest);
  }
}

export function deleteWorkflow(db: AppDatabase, workflowId: string): boolean {
  const existing = db.prepare('SELECT id FROM workflows WHERE id = ?').get(workflowId) as { id: string } | undefined;
  if (!existing) return false;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM approvals WHERE execution_id IN (SELECT id FROM executions WHERE workflow_id = ?)').run(workflowId);
    db.prepare('DELETE FROM executions WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM workflow_versions WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM trigger_receipts WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
    pruneWorkflowKeyedSettings(db, workflowId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return true;
}
