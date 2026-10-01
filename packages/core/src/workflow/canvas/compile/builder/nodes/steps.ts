import { capabilityActionName, resolveCapability } from '../../../../../catalog/capability-graph.js';
import type { SideEffectLevel, Step } from '../../../../schema.js';
import type { WorkflowCanvasDraft, WorkflowNode } from '../../../draft/schema.js';
import { getNodeBindings, getNodeParams, resolveNodeConnectorAction } from '../../../draft/actions.js';
import { resolveIfNodeCondition } from '../../../draft/conditions.js';
import { UnknownCapabilityError } from '../errors.js';

function outputSchemaFromFields(node: WorkflowNode): Record<string, unknown> | undefined {
  const fields = node.outputFields?.filter((field) => field.name.trim() && field.description.trim()) ?? [];
  if (fields.length === 0) return undefined;
  return {
    type: 'object',
    properties: Object.fromEntries(
      fields.map((field) => [
        field.name,
        {
          type: field.type,
          description: field.description,
          ...(field.purpose ? { purpose: field.purpose } : {}),
          ...(field.enumValues?.length ? { enum: field.enumValues } : {}),
        },
      ]),
    ),
    required: fields.map((field) => field.name),
  };
}

function toActionStep(draft: WorkflowCanvasDraft, node: WorkflowNode): Step | null {
  const resolved = resolveNodeConnectorAction(draft, node);
  if (!resolved) return null;

  const cap = resolveCapability(resolved.connector, resolved.action);
  if (!cap) {
    throw new UnknownCapabilityError(resolved.actionRef);
  }

  return {
    type: 'action',
    id: node.id,
    connector: cap.connector,
    action: capabilityActionName(cap),
    actionRef: resolved.actionRef,
    params: getNodeParams(draft, node),
    bindings: getNodeBindings(draft, node),
    sideEffect: (cap.sideEffect as SideEffectLevel | undefined) ?? 'EXTERNAL',
  };
}

export function toStep(draft: WorkflowCanvasDraft, node: WorkflowNode): Step | null {
  switch (node.type) {
    case 'action':
      return toActionStep(draft, node);
    case 'ai_decision':
      return {
        type: 'ai_decision',
        id: node.id,
        goal: node.goal?.trim() ?? '',
        memo: node.memo?.trim() || undefined,
        outputSchema: outputSchemaFromFields(node),
        investigation: node.investigation ?? false,
        bindings: node.bindings,
      };
    case 'if': {
      const condition = resolveIfNodeCondition(node);
      if (!condition) {
        throw new Error(node.id + ' if 노드에 condition이 필요합니다.');
      }
      return {
        type: 'if',
        id: node.id,
        condition,
        thenStepIds: node.thenStepIds ?? [],
        elseStepIds: node.elseStepIds,
      };
    }
    case 'human_approval':
      return {
        type: 'human_approval',
        id: node.id,
        reason: node.reason?.trim() ?? '',
        forActionIds: node.forActionIds ?? [],
      };
  }
}

export function consolidateApprovals(steps: Step[]): Step[] {
  // External side-effect approval is owned by action execution. Keep only
  // valid, explicitly branched legacy gates so a flat approval node cannot
  // run outside the branch that selected its action.
  return steps.filter(
    (step) => step.type !== 'human_approval' || step.forActionIds.length > 0,
  );
}
