import { z } from 'zod';
import { actionRefFor, resolveActionDefinition } from './action-definition.js';
import { capabilityActionName, resolveCapability } from '../catalog/capability-graph.js';
import type { SideEffectLevel, Step, WorkflowIR } from './schema.js';
import {
  AiDecisionStepSchema,
  HumanApprovalStepSchema,
  IfStepSchema,
  WorkflowIRSchema,
  parseWorkflowIR,
} from './schema.js';
import { ActionInstanceSchema, type ActionInstance } from './action-instance.js';
import { resolveEffectiveSideEffect } from './side-effect-resolve.js';

export const WORKFLOW_DOCUMENT_FORMAT = 'workflow-document@1' as const;

export const GraphActionStepSchema = z.object({
  type: z.literal('action'),
  id: z.string(),
});

export const GraphStepSchema = z.discriminatedUnion('type', [
  GraphActionStepSchema,
  AiDecisionStepSchema,
  IfStepSchema,
  HumanApprovalStepSchema,
]);

export const StoredWorkflowDocumentSchema = z.object({
  format: z.literal(WORKFLOW_DOCUMENT_FORMAT),
  workflow: WorkflowIRSchema.omit({ steps: true }).extend({
    steps: z.array(GraphStepSchema),
  }),
  actions: z.record(ActionInstanceSchema).default({}),
});

export type StoredWorkflowDocument = z.infer<typeof StoredWorkflowDocumentSchema>;
export type { ActionInstance };

function enrichActionStep(
  graphStep: z.infer<typeof GraphActionStepSchema>,
  instance: ActionInstance | undefined,
): Step {
  if (!instance?.actionRef?.trim()) {
    throw new Error(`action instance missing for step ${graphStep.id}`);
  }

  const definition = resolveActionDefinition(instance.actionRef);
  const connector = definition?.connector ?? instance.connector;
  const action = definition?.action ?? instance.action;
  if (!connector?.trim() || !action?.trim()) {
    throw new Error(`action instance missing for step ${graphStep.id}`);
  }

  const cap = resolveCapability(connector, action);
  if (!cap) {
    throw new Error(
      `action capability not found for step ${graphStep.id}: ${connector.trim()}.${action.trim()}`,
    );
  }

  return {
    type: 'action',
    id: graphStep.id,
    connector: cap.connector,
    action: capabilityActionName(cap),
    actionRef: instance.actionRef,
    params: instance.params ?? {},
    bindings: instance.bindings,
    sideEffect: definition
      ? resolveEffectiveSideEffect(definition, instance.params ?? {})
      : ((cap.sideEffect as SideEffectLevel | undefined) ?? 'EXTERNAL'),
  };
}

export function splitWorkflowIR(ir: WorkflowIR): StoredWorkflowDocument {
  const actions: Record<string, ActionInstance> = {};
  const steps: z.infer<typeof GraphStepSchema>[] = [];

  for (const step of ir.steps) {
    if (step.type === 'action') {
      actions[step.id] = {
        actionRef: step.actionRef ?? actionRefFor(step.connector, step.action),
        connector: step.connector,
        action: step.action,
        params: step.params ?? {},
        bindings: step.bindings,
      };
      steps.push({ type: 'action', id: step.id });
      continue;
    }
    steps.push(step);
  }

  const { steps: _steps, ...workflow } = ir;
  return {
    format: WORKFLOW_DOCUMENT_FORMAT,
    workflow: { ...workflow, steps },
    actions,
  };
}

export function mergeWorkflowDocument(document: StoredWorkflowDocument): WorkflowIR {
  const steps: Step[] = document.workflow.steps.map((step) => {
    if (step.type !== 'action') return step;
    return enrichActionStep(step, document.actions[step.id]);
  });

  return parseWorkflowIR({
    ...document.workflow,
    steps,
  });
}

export function serializeWorkflowForStorage(ir: WorkflowIR): string {
  return JSON.stringify(splitWorkflowIR(ir));
}

function migrateImplicitInvestigationReadBudget(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const envelope = data as Record<string, unknown>;
  const isDocument = envelope.format === WORKFLOW_DOCUMENT_FORMAT;
  const workflow = isDocument && envelope.workflow && typeof envelope.workflow === 'object'
    ? envelope.workflow as Record<string, unknown>
    : envelope;
  if (!Array.isArray(workflow.steps)) return data;

  let changed = false;
  const steps = workflow.steps.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
    const record = step as Record<string, unknown>;
    // Older Canvas compilation silently inserted four reads; no UI exposed it as a user budget.
    if (record.type !== 'ai_decision' || record.investigation !== true || record.maxReads !== 4) return step;
    const { maxReads: _legacyDefault, ...migrated } = record;
    changed = true;
    return migrated;
  });
  if (!changed) return data;
  return isDocument
    ? { ...envelope, workflow: { ...workflow, steps } }
    : { ...envelope, steps };
}

export function parseStoredWorkflow(data: unknown): WorkflowIR {
  const migrated = migrateImplicitInvestigationReadBudget(data);
  if (!data || typeof data !== 'object') {
    return parseWorkflowIR(migrated);
  }

  const record = migrated as Record<string, unknown>;
  if (record.format === WORKFLOW_DOCUMENT_FORMAT) {
    return mergeWorkflowDocument(StoredWorkflowDocumentSchema.parse(migrated));
  }

  return parseWorkflowIR(migrated);
}
