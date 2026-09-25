import type { ConnectorContext } from '../../../connectors/types.js';
import type { DecisionEngine } from '../../../contracts/decision.js';
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
  requirements: {
    document: boolean;
    emailBody: boolean;
    boundInputPorts?: readonly string[];
    readSources?: readonly string[];
  },
): boolean {
  const requiredPolicies = [
    requirements.document ? ir.dataPolicy?.document?.cloudAllowed !== false : true,
    requirements.emailBody ? ir.dataPolicy?.emailBody?.cloudAllowed !== false : true,
    ...(requirements.boundInputPorts ?? []).map((port) => ir.dataPolicy?.[port]?.cloudAllowed !== false),
    ...(requirements.readSources ?? []).map((source) => cloudDataAllowedForReadSource(ir, source)),
  ];
  return requiredPolicies.every(Boolean);
}

export function cloudDataAllowedForReadSource(ir: WorkflowIR, source: string): boolean {
  const connector = source.split('.', 1)[0] ?? source;
  return ir.dataPolicy?.[source]?.cloudAllowed !== false
    && ir.dataPolicy?.[connector]?.cloudAllowed !== false;
}

export function decisionEngineCanReceiveEvidence(
  engine: Pick<DecisionEngine, 'dataHandling'> | undefined,
  ir: WorkflowIR,
  cloudAllowed: boolean,
  source: string,
): boolean {
  if (!engine) return false;
  if (engine.dataHandling === 'local') return true;
  return cloudAllowed && cloudDataAllowedForReadSource(ir, source);
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
