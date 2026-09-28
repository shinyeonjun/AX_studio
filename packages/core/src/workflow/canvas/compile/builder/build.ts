import type { Step, WorkflowIR } from '../../../schema.js';
import { applyContractCompilation } from '../../../contract-adapters.js';
import { parseWorkflowIR } from '../../../schema.js';
import { renderWorkflowDocument } from '../../presentation/workflow-document.js';
import type { WorkflowCanvasDraftInput } from '../../draft/schema.js';
import { resolveNodeConnectorAction } from '../../draft/actions.js';
import { validateCanvasDraftStructure } from '../validate-graph/structure.js';
import {
  buildTrigger,
  consolidateApprovals,
  injectGmailReadIfNeeded,
  normalizeDraft,
  toStep,
  workflowInputs,
} from './nodes.js';
import { UnknownCapabilityError } from './errors.js';

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
