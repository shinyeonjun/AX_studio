import type { ConnectorContext } from '../../../modules/types.js';
import type { Step, WorkflowIR } from '../../../workflow/schema.js';
import { resolveAiDecisionBindings } from '../../../workflow/bindings.js';
import {
  documentTextFromRun,
  documentVisualReferencesFromRun,
  emailBodyFromRun,
} from '../input.js';

export function workflowNeedsDocumentEvidence(ir: WorkflowIR, step: Step & { type: 'ai_decision' }): boolean {
  const bound = resolveAiDecisionBindings(step, ir, {}, {});
  if (bound.usesExplicitBindings) {
    return bound.hasDocumentArtifact || Object.values(step.inputContracts ?? {}).includes('DocumentArtifact');
  }
  return ir.steps.some(
    (candidate) =>
      candidate.type === 'action' &&
      candidate.connector === 'document' &&
      candidate.action === 'ingest',
  );
}

export function hasDecisionEvidenceFromBindings(
  step: Step & { type: 'ai_decision' },
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  evidence: Array<{ source: string; detail: string }>,
): boolean {
  const bound = resolveAiDecisionBindings(step, ir, stepResults, ctx.variables, ctx.outputs);
  if (bound.usesExplicitBindings) {
    return Boolean(
      evidence.length > 0 ||
        bound.emailBody?.trim() ||
        bound.documentText?.trim() ||
        bound.hasDocumentArtifact ||
        documentVisualReferencesFromRun(ctx.variables, stepResults).length > 0,
    );
  }
  return hasDecisionEvidence(ctx, stepResults, evidence);
}

export function cloudDataAllowedForDecision(
  ir: WorkflowIR,
  requirements: { document: boolean; emailBody: boolean },
): boolean {
  const requiredPolicies = [
    requirements.document ? ir.dataPolicy?.document?.cloudAllowed !== false : true,
    requirements.emailBody ? ir.dataPolicy?.emailBody?.cloudAllowed !== false : true,
  ];
  return requiredPolicies.every(Boolean);
}

export function hasDecisionEvidence(
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  evidence: Array<{ source: string; detail: string }>,
): boolean {
  return Boolean(
    evidence.length > 0 ||
      emailBodyFromRun(ctx.variables, stepResults)?.trim() ||
      documentTextFromRun(ctx.variables, stepResults)?.trim() ||
      documentVisualReferencesFromRun(ctx.variables, stepResults).length > 0,
  );
}
