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

/** App setting: when true, no work content (mail, documents, read results) goes to a cloud service. */
export const KEEP_CONTENT_LOCAL_SETTING = 'privacy.keepContentLocal';

/** A policy key covering every input: the person chose to keep all work content on this computer. */
export const ALL_CONTENT_POLICY_KEY = '*';

/** The workflow as run when the person keeps work content on this computer: nothing may go to a cloud service. */
export function withContentKeptLocal<T extends Pick<WorkflowIR, 'dataPolicy'>>(ir: T): T {
  return { ...ir, dataPolicy: { ...ir.dataPolicy, [ALL_CONTENT_POLICY_KEY]: { cloudAllowed: false } } };
}

function allContentKeptLocal(ir: Pick<WorkflowIR, 'dataPolicy'>): boolean {
  return ir.dataPolicy?.[ALL_CONTENT_POLICY_KEY]?.cloudAllowed === false;
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
    !allContentKeptLocal(ir),
    requirements.document ? ir.dataPolicy?.document?.cloudAllowed !== false : true,
    requirements.emailBody ? ir.dataPolicy?.emailBody?.cloudAllowed !== false : true,
    ...(requirements.boundInputPorts ?? []).map((port) => ir.dataPolicy?.[port]?.cloudAllowed !== false),
    ...(requirements.readSources ?? []).map((source) => cloudDataAllowedForReadSource(ir, source)),
  ];
  return requiredPolicies.every(Boolean);
}

export function cloudDataAllowedForReadSource(ir: WorkflowIR, source: string): boolean {
  const connector = source.split('.', 1)[0] ?? source;
  return !allContentKeptLocal(ir)
    && ir.dataPolicy?.[source]?.cloudAllowed !== false
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

function hasDecisionEvidence(
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
