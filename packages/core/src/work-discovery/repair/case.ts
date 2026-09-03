import { applyRepairCandidate, type RepairCandidateOperation, type RepairReplayCase } from '../../workflow/repair.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { evaluateTransformExpr } from '../../workflow/transform-expr/evaluator.js';
import { TransformExprSchema } from '../../workflow/transform-expr/dsl.js';
import { OutputObservationSchema, type OutputObservation } from '../observation/schema.js';
import { compareObservationValue, replayPassThreshold } from '../synthesis/compare.js';
import { renameHistoricalTable } from './table.js';

export function parseExpectedObservations(json: string): OutputObservation[] | undefined {
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

export function replayOneCase(
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
