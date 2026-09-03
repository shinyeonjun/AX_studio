import type { Step, WorkflowIR } from '../../../../workflow/schema.js';
import { applyContractCompilation } from '../../../../workflow/contract-adapters.js';
import { parseWorkflowIR, validateWorkflowIR } from '../../../../workflow/schema.js';
import { renderWorkflowDocument } from '../../presentation/workflow-document.js';
import type { WorkflowCanvasDraftInput } from '../../draft/schema.js';
import { resolveNodeConnectorAction } from '../../draft/actions.js';
import { validateCanvasDraftStructure } from '../validate-graph.js';
import {
  buildTrigger,
  consolidateApprovals,
  injectGmailReadIfNeeded,
  normalizeDraft,
  toStep,
  toStepLenient,
  workflowInputs,
} from './nodes.js';
import { UnknownCapabilityError } from './errors.js';

export function buildLenientIRFromWorkflow(draft: WorkflowCanvasDraftInput): Partial<WorkflowIR> {
  const normalizedDraft = normalizeDraft(draft);
  const rawSteps = normalizedDraft.nodes
    .map((node) => toStepLenient(normalizedDraft, node))
    .filter((step): step is Step => step !== null);
  const steps = consolidateApprovals(injectGmailReadIfNeeded(rawSteps, normalizedDraft));
  const ir: Partial<WorkflowIR> = {
    name: normalizedDraft.name,
    goal: normalizedDraft.goal,
    version: 1,
    trigger: buildTrigger(normalizedDraft),
    steps,
    success: normalizedDraft.success,
    assumptions: normalizedDraft.assumptions,
    inputs: workflowInputs(normalizedDraft.triggerType, steps),
    permissions: {},
    approval: steps
      .filter((step): step is Extract<Step, { type: 'action' }> =>
        step.type === 'action' && step.sideEffect === 'EXTERNAL_HIGH',
      )
      .map((step) => step.connector + '.' + step.action),
    allowExternalAuto: false,
    dataPolicy: {
      emailBody: { cloudAllowed: true },
      document: { cloudAllowed: true },
    },
    sideEffects: Object.fromEntries(
      steps.filter((step) => step.type === 'action').map((step) => [step.id, step.sideEffect]),
    ),
  };
  // Conversational completeness may inspect a partial IR, but only a schema-
  // valid IR may enter contract compilation. Invalid partial data remains
  // visible as-is so the slot layer can ask for it instead of hiding a parser
  // or compiler defect behind a generic fallback.
  const validation = validateWorkflowIR(ir);
  if (!validation.ok) return ir;

  const compiled = applyContractCompilation(validation.value);
  compiled.document = renderWorkflowDocument(compiled);
  return compiled;
}

export function buildIRFromWorkflow(draft: WorkflowCanvasDraftInput): Partial<WorkflowIR> {
  const normalized = normalizeDraft(draft);
  const graphIssues = validateCanvasDraftStructure(normalized);
  if (graphIssues.length > 0) {
    const error = new Error(graphIssues[0]!.message) as Error & {
      code: string;
      issues: typeof graphIssues;
    };
    error.code = 'workflow_graph_invalid';
    error.issues = graphIssues;
    throw error;
  }
  const rawSteps = normalized.nodes
    .map((node) => toStep(normalized, node))
    .filter((step): step is Step => step !== null);

  for (const node of normalized.nodes) {
    if (node.type !== 'action') continue;
    if (rawSteps.some((step) => step.type === 'action' && step.id === node.id)) continue;

    const instance = normalized.actions?.[node.id];
    const hasCapabilityChoice = Boolean(
      node.actionRef?.trim() ||
        instance?.actionRef?.trim() ||
        instance?.connector?.trim() ||
        instance?.action?.trim(),
    );
    if (!hasCapabilityChoice) continue;

    const resolved = resolveNodeConnectorAction(normalized, node);
    throw new UnknownCapabilityError(
      resolved?.actionRef ??
        instance?.actionRef ??
        node.actionRef ??
        (instance?.connector ?? 'unknown') + '.' + (instance?.action ?? 'unknown'),
    );
  }

  const steps = consolidateApprovals(injectGmailReadIfNeeded(rawSteps, normalized));
  const ir: Partial<WorkflowIR> = {
    name: normalized.name,
    goal: normalized.goal,
    version: 1,
    trigger: buildTrigger(normalized),
    steps,
    success: normalized.success,
    assumptions: normalized.assumptions,
    inputs: workflowInputs(normalized.triggerType, steps),
    permissions: {},
    approval: steps
      .filter((step): step is Extract<Step, { type: 'action' }> =>
        step.type === 'action' && step.sideEffect === 'EXTERNAL_HIGH',
      )
      .map((step) => step.connector + '.' + step.action),
    allowExternalAuto: false,
    dataPolicy: {
      emailBody: { cloudAllowed: true },
      document: { cloudAllowed: true },
    },
    sideEffects: Object.fromEntries(
      steps.filter((step) => step.type === 'action').map((step) => [step.id, step.sideEffect]),
    ),
  };
  const compiled = applyContractCompilation(parseWorkflowIR(ir));
  compiled.document = renderWorkflowDocument(compiled);
  return compiled;
}
