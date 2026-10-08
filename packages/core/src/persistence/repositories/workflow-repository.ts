import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import { readRow, readRows } from '../db/types.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { parseWorkflowIR } from '../../workflow/schema.js';
import { parseStoredWorkflow, serializeWorkflowForStorage } from '../../workflow/persisted-document.js';
import { validateWorkflowForPersistence } from '../../workflow/contract-validator.js';
import {
  type AgentScopedContextMap,
  type AgentScopedContextPatch,
  mergeAgentScopedContext,
  parseStoredAgentScopedContext,
} from '../../intelligence/agent/scoped-context.js';
import * as settingsRepo from './settings-repository.js';
import { mapRowsTolerant, recordCorruptRow } from '../tolerant-rows.js';

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
  const existing = readRow<{ id: string }>(db.prepare('SELECT id FROM workflows WHERE id = ?'), workflowId);
  const latest = readRow<{ version?: number | null }>(
    db.prepare('SELECT MAX(version) AS version FROM workflow_versions WHERE workflow_id = ?'),
    workflowId,
  );
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

function parseWorkflowVersion(workflowId: string, version: number, irJson: string): WorkflowIR {
  try {
    return parseStoredWorkflow(JSON.parse(irJson));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(
      new Error(`워크플로우 ${workflowId} 버전 ${version}의 JSON이 손상되었거나 계약에 맞지 않습니다: ${detail}`),
      { code: 'invalid_workflow_json', workflowId, version },
    );
  }
}

export function getWorkflow(db: AppDatabase, workflowId: string, version?: number): WorkflowIR | null {
  const target = version
    ? readRow<{ version: number; ir_json: string }>(db.prepare(
      'SELECT version, ir_json FROM workflow_versions WHERE workflow_id = ? AND version = ?'), workflowId, version)
    : readRow<{ version: number; ir_json: string }>(db.prepare(
      'SELECT version, ir_json FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 1'), workflowId);
  if (!target) return null;
  return parseWorkflowVersion(workflowId, target.version, target.ir_json);
}

export function getWorkflowPolicy(db: AppDatabase, workflowId: string): AgentScopedContextMap {
  const row = readRow<{ policy_json?: string | null }>(
    db.prepare('SELECT policy_json FROM workflows WHERE id = ?'),
    workflowId,
  );
  return parseStoredAgentScopedContext(row?.policy_json);
}

export function updateWorkflowPolicy(
  db: AppDatabase,
  workflowId: string,
  patch: AgentScopedContextPatch,
): AgentScopedContextMap | null {
  const row = readRow<{ id: string; policy_json?: string | null }>(
    db.prepare('SELECT id, policy_json FROM workflows WHERE id = ?'),
    workflowId,
  );
  if (!row) return null;
  const next = mergeAgentScopedContext(parseStoredAgentScopedContext(row.policy_json), patch);
  db.prepare('UPDATE workflows SET policy_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(next), new Date().toISOString(), workflowId);
  return next;
}

export function listWorkflows(db: AppDatabase): Array<{ id: string; name: string; active: boolean; latestVersion: number }> {
  const rows = readRows<{ id: string; name: string; active: number; latestVersion: number }>(db.prepare(
    `SELECT s.id, s.name, s.active, COALESCE(MAX(sv.version), 0) AS latestVersion
     FROM workflows s
     LEFT JOIN workflow_versions sv ON sv.workflow_id = s.id
     GROUP BY s.id, s.name, s.active`,
  ));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    active: Boolean(row.active),
    latestVersion: row.latestVersion ?? 0,
  }));
}

export function listWorkflowDefinitions(db: AppDatabase): Array<{
  id: string;
  name: string;
  active: boolean;
  latestVersion: number;
  workflow: WorkflowIR | null;
  corrupted?: true;
}> {
  const rows = readRows<{
    id: string;
    name: string;
    active: number;
    version: number | null;
    ir_json: string | null;
  }>(db.prepare(
    `SELECT w.id, w.name, w.active, v.version, v.ir_json
     FROM workflows w
     LEFT JOIN workflow_versions v
       ON v.workflow_id = w.id
       AND v.version = (SELECT MAX(version) FROM workflow_versions WHERE workflow_id = w.id)`,
  ));

  return rows.map(({ id, name, active, version, ir_json }) => {
    const summary = { id, name, active: Boolean(active), latestVersion: version ?? 0 };
    if (version === null || ir_json === null) return { ...summary, workflow: null };
    try {
      return { ...summary, workflow: parseWorkflowVersion(id, version, ir_json) };
    } catch (error) {
      // Keep the workflow listed so the user can see and delete or repair it.
      recordCorruptRow(db, 'workflow_versions', `${id}@${version}`, error);
      return { ...summary, workflow: null, corrupted: true as const };
    }
  });
}

// Scheduler and trigger scans share this batch read instead of querying each active workflow separately.
// A corrupt workflow is skipped (and reported) so it cannot stop every other automation.
export function listActiveWorkflowDefinitions(db: AppDatabase): Array<{ id: string; workflow: WorkflowIR }> {
  const rows = readRows<{ id: string; version: number; ir_json: string }>(db.prepare(
    `SELECT w.id, v.version, v.ir_json
     FROM workflows w
     JOIN workflow_versions v
       ON v.workflow_id = w.id
       AND v.version = (SELECT MAX(version) FROM workflow_versions WHERE workflow_id = w.id)
     WHERE w.active = 1`,
  ));
  return mapRowsTolerant(db, 'workflow_versions', rows, (row) => `${row.id}@${row.version}`, ({ id, version, ir_json }) => ({
    id,
    workflow: parseWorkflowVersion(id, version, ir_json),
  }));
}

export function setWorkflowActive(db: AppDatabase, workflowId: string, active: boolean): boolean {
  db.prepare('UPDATE workflows SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, new Date().toISOString(), workflowId);
  const row = readRow<{ count?: number }>(db.prepare('SELECT changes() AS count'));
  return Number(row?.count ?? 0) === 1;
}

export function isWorkflowActive(db: AppDatabase, workflowId: string): boolean {
  return workflowActiveState(db, workflowId) === true;
}

/** The saved on/off switch, or undefined for a workflow that is not saved (a one-off run). */
export function workflowActiveState(db: AppDatabase, workflowId: string): boolean | undefined {
  const row = readRow<{ active: number }>(db.prepare('SELECT active FROM workflows WHERE id = ?'), workflowId);
  return row ? Boolean(row.active) : undefined;
}

// Settings blobs keyed by workflow id that must not outlive the workflow.
// Owners: runtime/scheduler.ts (lastFired) and triggers/types.ts (cursors).
const WORKFLOW_KEYED_SETTINGS = ['scheduler.lastFired', 'trigger.cursors'];

// Per-workflow settings stored under their own key (`<prefix><encodeURIComponent(id)>`).
// Owners: runtime/scheduler/service.ts (LAST_FIRED_SETTING / LAST_OUTCOME_SETTING_PREFIX).
export const WORKFLOW_SUFFIXED_SETTING_PREFIXES = ['scheduler.lastFired:', 'scheduler.lastOutcome:'];
// Settings arrays whose entries carry a `workflowId`. Owner: runtime/trigger-engine/receipts.ts (DEAD_LETTER_SETTING).
export const WORKFLOW_ENTRY_LIST_SETTINGS = ['trigger.deadLetters'];
// Per-receipt retry state, keyed `<prefix><encodeURIComponent(dedupeKey)>`. Owner: runtime/trigger-engine/receipts.ts.
export const TRIGGER_RECEIPT_ATTEMPT_PREFIX = 'trigger.receiptAttempt:';

function pruneWorkflowKeyedSettings(db: AppDatabase, workflowId: string, receiptKeys: readonly string[]): void {
  for (const key of WORKFLOW_KEYED_SETTINGS) {
    const value = settingsRepo.getSetting<Record<string, unknown>>(db, key, {});
    if (!value || typeof value !== 'object' || !(workflowId in value)) continue;
    const { [workflowId]: _removed, ...rest } = value;
    settingsRepo.setSetting(db, key, rest);
  }
  for (const prefix of WORKFLOW_SUFFIXED_SETTING_PREFIXES) {
    settingsRepo.deleteSetting(db, `${prefix}${encodeURIComponent(workflowId)}`);
  }
  for (const key of WORKFLOW_ENTRY_LIST_SETTINGS) {
    const value = settingsRepo.getSetting<unknown>(db, key, []);
    if (!Array.isArray(value)) continue;
    const kept = value.filter((entry) => !(entry && typeof entry === 'object'
      && (entry as { workflowId?: unknown }).workflowId === workflowId));
    if (kept.length !== value.length) settingsRepo.setSetting(db, key, kept);
  }
  // Exact keys from this workflow's own receipts; a prefix match on the encoded id could
  // also hit another workflow whose id merely starts with this one.
  for (const dedupeKey of receiptKeys) {
    settingsRepo.deleteSetting(db, `${TRIGGER_RECEIPT_ATTEMPT_PREFIX}${encodeURIComponent(dedupeKey)}`);
  }
}

/**
 * Deletes a workflow so it never runs again. Its run history (and the approvals that record what
 * was sent where) stays, named by each run's own snapshot, unless `deleteHistory` asks to clear it.
 */
export function deleteWorkflow(db: AppDatabase, workflowId: string, options: { deleteHistory?: boolean } = {}): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = readRow<{ id: string }>(db.prepare('SELECT id FROM workflows WHERE id = ?'), workflowId);
    if (!existing) {
      db.exec('COMMIT');
      return false;
    }
    const activeExecution = readRow<{ id: string }>(
      db.prepare(
        "SELECT id FROM executions WHERE workflow_id = ? AND status IN ('running', 'pending_approval') LIMIT 1",
      ),
      workflowId,
    );
    if (activeExecution) {
      throw Object.assign(new Error('실행 중인 워크플로우는 삭제할 수 없습니다.'), {
        code: 'workflow_execution_active',
        executionId: activeExecution.id,
      });
    }
    if (options.deleteHistory) {
      db.prepare('DELETE FROM approvals WHERE execution_id IN (SELECT id FROM executions WHERE workflow_id = ?)').run(workflowId);
      db.prepare('DELETE FROM executions WHERE workflow_id = ?').run(workflowId);
    }
    db.prepare('DELETE FROM workflow_versions WHERE workflow_id = ?').run(workflowId);
    const receiptKeys = readRows<{ dedupe_key: string }>(
      db.prepare('SELECT dedupe_key FROM trigger_receipts WHERE workflow_id = ?'),
      workflowId,
    ).map((row) => row.dedupe_key).filter((key): key is string => typeof key === 'string');
    db.prepare('DELETE FROM trigger_receipts WHERE workflow_id = ?').run(workflowId);
    db.prepare('DELETE FROM workflows WHERE id = ?').run(workflowId);
    // The conversation that made the work stays; it just no longer opens a work that is gone.
    db.prepare('UPDATE workspace_chats SET workflow_id = NULL WHERE workflow_id = ?').run(workflowId);
    // The push journal is not pruned: its entries are per trigger type, may fan out to other
    // workflows, and replay only matches workflows that still exist.
    pruneWorkflowKeyedSettings(db, workflowId, receiptKeys);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return true;
}
