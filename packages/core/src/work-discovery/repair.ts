import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { TableArtifactSchema, type TableArtifact } from '../contracts/artifacts/table.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import {
  applyRepairCandidate,
  type RepairCandidateOperation,
  type RepairReplayCase,
  type RepairReplaySummary,
} from '../workflow/repair.js';
import { evaluateTransformExpr } from '../workflow/transform-expr/evaluator.js';
import { TransformExprSchema } from '../workflow/transform-expr/dsl.js';
import { OutputObservationSchema, type OutputObservation } from './observation/schema.js';
import { compareObservationValue, replayPassThreshold } from './synthesis/compare.js';

export interface RepairReplayOptions {
  /** The host-owned root under which Work Discovery writes <sessionId>/. */
  snapshotRoot: string;
}

function isWithinRoot(rootDir: string, filePath: string): boolean {
  const root = resolve(rootDir);
  const candidate = resolve(filePath);
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function sessionIdForWorkflow(workflow: WorkflowIR): string | undefined {
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

function loadSnapshots(
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

function renameHistoricalTable(table: TableArtifact, candidate: RepairCandidateOperation): TableArtifact | null {
  const fromColumn = table.columns.some((column) => column.name === candidate.from);
  if (!fromColumn) return table;
  if (table.columns.some((column) => column.name === candidate.to)) return null;
  const columns = table.columns.map((column) =>
    column.name === candidate.from ? { ...column, name: candidate.to } : column);
  const rows = table.rows.map((row) => {
    const { [candidate.from]: fromValue, ...rest } = row.values;
    return { ...row, values: { ...rest, [candidate.to]: fromValue ?? null } };
  });
  const profile = table.profile
    ? {
      ...table.profile,
      columns: Object.fromEntries(Object.entries(table.profile.columns).map(([name, value]) =>
        name === candidate.from ? [candidate.to, value] : [name, value])),
    }
    : undefined;
  return TableArtifactSchema.parse({ ...table, columns, rows, ...(profile ? { profile } : {}) });
}

function parseExpectedObservations(json: string): OutputObservation[] | undefined {
  try {
    const parsed = OutputObservationSchema.array().safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function evaluationSteps(workflow: WorkflowIR): Array<{ outputPath: string; expr: ReturnType<typeof TransformExprSchema.parse> }> {
  return workflow.steps.flatMap((step) => {
    if (step.type !== 'action' || step.connector !== 'transform' || step.action !== 'evaluate') return [];
    const outputPath = step.params.outputPath;
    const parsed = TransformExprSchema.safeParse(step.params.expr);
    return typeof outputPath === 'string' && parsed.success
      ? [{ outputPath, expr: parsed.data }]
      : [];
  });
}

function replayOneCase(
  workflow: WorkflowIR,
  candidate: RepairCandidateOperation,
  observations: OutputObservation[],
  snapshots: Record<string, TableArtifact>,
  caseId: string,
  exampleId: string,
): RepairReplayCase {
  const required = observations.filter((observation) => observation.required);
  if (required.length === 0) return { caseId, exampleId, pass: false, reason: 'required_observation_missing' };

  let repaired: WorkflowIR;
  try {
    repaired = applyRepairCandidate(workflow, candidate);
  } catch {
    return { caseId, exampleId, pass: false, reason: 'candidate_not_applicable' };
  }
  const evaluations = evaluationSteps(repaired);
  const renamedSnapshots: Record<string, TableArtifact> = { ...snapshots };
  const sourceSnapshot = renamedSnapshots[candidate.sourceId];
  if (!sourceSnapshot) return { caseId, exampleId, pass: false, reason: 'source_snapshot_missing' };
  const renamed = renameHistoricalTable(sourceSnapshot, candidate);
  if (!renamed) return { caseId, exampleId, pass: false, reason: 'historical_target_column_exists' };
  if (renamedSnapshots[candidate.sourceId]) renamedSnapshots[candidate.sourceId] = renamed;

  for (const observation of required) {
    const evaluation = evaluations.find((entry) => entry.outputPath === observation.path);
    if (!evaluation) return { caseId, exampleId, pass: false, reason: 'mapping_missing' };
    try {
      const actual = evaluateTransformExpr(evaluation.expr, renamedSnapshots);
      if (!replayPassThreshold(compareObservationValue(observation.value, actual))) {
        return { caseId, exampleId, pass: false, reason: 'observation_mismatch' };
      }
    } catch {
      return { caseId, exampleId, pass: false, reason: 'mapping_evaluation_failed' };
    }
  }
  return { caseId, exampleId, pass: true };
}

/** Replays one repair candidate against every persisted Work Discovery case. */
export function replayRepairCandidate(
  store: WorkflowStore,
  workflow: WorkflowIR,
  candidate: RepairCandidateOperation,
  options: RepairReplayOptions,
): RepairReplaySummary {
  const sessionId = sessionIdForWorkflow(workflow);
  if (!sessionId) {
    return {
      status: 'unavailable',
      total: 0,
      passed: 0,
      failed: 0,
      cases: [],
      reason: 'historical_session_unavailable',
    };
  }
  const cases = store.listDiscoveryReplayCases(sessionId);
  if (cases.length === 0) {
    return {
      status: 'unavailable',
      total: 0,
      passed: 0,
      failed: 0,
      cases: [],
      reason: 'historical_replay_unavailable',
    };
  }

  const replayCases: RepairReplayCase[] = [];
  for (const replayCase of cases) {
    const observations = parseExpectedObservations(replayCase.expectedObservationsJson);
    if (!observations) {
      return {
        status: 'unavailable',
        total: 0,
        passed: 0,
        failed: 0,
        cases: [],
        reason: 'historical_replay_case_invalid',
      };
    }
    const loaded = loadSnapshots(store, sessionId, replayCase.exampleId, options.snapshotRoot);
    if (!loaded.ok) {
      return {
        status: 'unavailable',
        total: 0,
        passed: 0,
        failed: 0,
        cases: [],
        reason: loaded.reason,
      };
    }
    replayCases.push(replayOneCase(
      workflow,
      candidate,
      observations,
      loaded.snapshots,
      replayCase.id,
      replayCase.exampleId,
    ));
  }

  const passed = replayCases.filter((entry) => entry.pass).length;
  const failed = replayCases.length - passed;
  return {
    status: failed === 0 ? 'passed' : 'failed',
    total: replayCases.length,
    passed,
    failed,
    cases: replayCases,
  };
}
