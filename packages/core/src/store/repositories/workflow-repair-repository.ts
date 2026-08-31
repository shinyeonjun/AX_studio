import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db.js';
import type { WorkflowRepairProposalRow } from '../rows.js';
import {
  emptyRepairReplaySummary,
  RepairProposalSchema,
  RepairReplaySummarySchema,
  repairDedupeKey,
  type RepairCandidateOperation,
  type RepairProposal,
  type RepairReplaySummary,
} from '../../workflow/repair.js';

function parseJson(value: string, proposalId: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`repair proposal ${proposalId} JSON is corrupted: ${detail}`), {
      code: 'invalid_repair_proposal_json',
      proposalId,
    });
  }
}

function mapRow(row: WorkflowRepairProposalRow): RepairProposal {
  const parsed = RepairProposalSchema.safeParse(parseJson(row.proposal_json, row.id));
  if (!parsed.success || parsed.data.id !== row.id || parsed.data.workflowId !== row.workflow_id ||
      parsed.data.baseVersion !== row.base_version || parsed.data.status !== row.status ||
      parsed.data.appliedVersion !== (row.applied_version ?? undefined)) {
    throw Object.assign(new Error(`repair proposal ${row.id} has an invalid persisted shape`), {
      code: 'invalid_repair_proposal',
      proposalId: row.id,
    });
  }
  return parsed.data;
}

function rowFor(db: AppDatabase, id: string): WorkflowRepairProposalRow | undefined {
  return db.prepare('SELECT * FROM workflow_repair_proposals WHERE id = ?').get(id) as
    | WorkflowRepairProposalRow
    | undefined;
}

export function getWorkflowRepairProposal(db: AppDatabase, id: string): RepairProposal | undefined {
  const row = rowFor(db, id);
  return row ? mapRow(row) : undefined;
}

export function listWorkflowRepairProposals(
  db: AppDatabase,
  options: { workflowId?: string; status?: RepairProposal['status'] } = {},
): RepairProposal[] {
  const rows = options.workflowId && options.status
    ? db.prepare('SELECT * FROM workflow_repair_proposals WHERE workflow_id = ? AND status = ? ORDER BY created_at ASC, id ASC').all(options.workflowId, options.status)
    : options.workflowId
      ? db.prepare('SELECT * FROM workflow_repair_proposals WHERE workflow_id = ? ORDER BY created_at ASC, id ASC').all(options.workflowId)
      : options.status
        ? db.prepare('SELECT * FROM workflow_repair_proposals WHERE status = ? ORDER BY created_at ASC, id ASC').all(options.status)
        : db.prepare('SELECT * FROM workflow_repair_proposals ORDER BY created_at ASC, id ASC').all();
  return (rows as unknown as WorkflowRepairProposalRow[]).map(mapRow);
}

export function createWorkflowRepairProposal(
  db: AppDatabase,
  params: {
    workflowId: string;
    baseVersion: number;
    candidates: RepairCandidateOperation[];
  },
): RepairProposal {
  const candidates = params.candidates.map((candidate) => RepairProposalSchema.shape.candidates.element.parse(candidate));
  const dedupeKey = repairDedupeKey(params.workflowId, params.baseVersion, candidates);
  const existing = db.prepare('SELECT * FROM workflow_repair_proposals WHERE dedupe_key = ?').get(dedupeKey) as
    | WorkflowRepairProposalRow
    | undefined;
  if (existing) return mapRow(existing);

  const now = new Date().toISOString();
  const proposal: RepairProposal = {
    id: `repair_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    workflowId: params.workflowId,
    baseVersion: params.baseVersion,
    status: 'proposed',
    candidates,
    replay: emptyRepairReplaySummary(),
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO workflow_repair_proposals
      (id, workflow_id, base_version, status, dedupe_key, proposal_json, applied_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    proposal.id,
    proposal.workflowId,
    proposal.baseVersion,
    proposal.status,
    dedupeKey,
    JSON.stringify(proposal),
    null,
    proposal.createdAt,
    proposal.updatedAt,
  );
  return proposal;
}

export function updateWorkflowRepairProposalReplay(
  db: AppDatabase,
  id: string,
  replay: RepairReplaySummary,
): RepairProposal | undefined {
  const current = getWorkflowRepairProposal(db, id);
  if (!current) return undefined;
  const parsedReplay = RepairReplaySummarySchema.parse(replay);
  const next: RepairProposal = RepairProposalSchema.parse({
    ...current,
    replay: parsedReplay,
    updatedAt: new Date().toISOString(),
  });
  db.prepare('UPDATE workflow_repair_proposals SET proposal_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(next), next.updatedAt, id);
  return next;
}

export function updateWorkflowRepairProposal(
  db: AppDatabase,
  id: string,
  patch: {
    status: RepairProposal['status'];
    appliedVersion?: number;
    rejectionReason?: string;
  },
): RepairProposal | undefined {
  const current = getWorkflowRepairProposal(db, id);
  if (!current) return undefined;
  const next: RepairProposal = RepairProposalSchema.parse({
    ...current,
    status: patch.status,
    appliedVersion: patch.status === 'applied' ? patch.appliedVersion : undefined,
    rejectionReason: patch.status === 'rejected' ? patch.rejectionReason : undefined,
    updatedAt: new Date().toISOString(),
  });
  db.prepare(
    `UPDATE workflow_repair_proposals
     SET status = ?, proposal_json = ?, applied_version = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.status,
    JSON.stringify(next),
    next.appliedVersion ?? null,
    next.updatedAt,
    id,
  );
  return next;
}
