import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { parseWorkflowIR } from '../../workflow/schema.js';

export function saveWorkflow(db: AppDatabase, ir: WorkflowIR): { workflowId: string; version: number } {
  const now = new Date().toISOString();
  const workflowId = ir.id ?? randomUUID();
  const version = ir.version;

  const existing = db.prepare('SELECT id FROM workflows WHERE id = ?').get(workflowId) as { id: string } | undefined;

  if (!existing) {
    db.prepare('INSERT INTO workflows (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(workflowId, ir.name, now, now);
  } else {
    db.prepare('UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?').run(ir.name, now, workflowId);
  }

  const versionId = randomUUID();
  const irWithId = { ...ir, id: workflowId, version };
  db
    .prepare('INSERT INTO workflow_versions (id, workflow_id, version, ir_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(versionId, workflowId, version, JSON.stringify(irWithId), now);

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
  return parseWorkflowIR(JSON.parse(target.ir_json));
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

export function setWorkflowActive(db: AppDatabase, workflowId: string, active: boolean) {
  db.prepare('UPDATE workflows SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, new Date().toISOString(), workflowId);
}

export function deleteWorkflow(db: AppDatabase, workflowId: string): boolean {
  const existing = db.prepare('SELECT id FROM workflows WHERE id = ?').get(workflowId) as { id: string } | undefined;
  if (!existing) return false;
  db.prepare('DELETE FROM approvals WHERE execution_id IN (SELECT id FROM executions WHERE workflow_id = ?)').run(workflowId);
  db.prepare('DELETE FROM executions WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM workflow_versions WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM chat_sessions WHERE workflow_id = ?').run(workflowId);
  db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
  return true;
}
