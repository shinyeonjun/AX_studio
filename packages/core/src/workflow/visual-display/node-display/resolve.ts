import { getCapability } from '../../../catalog/capabilities.js';
import { getConnectorLabel } from '../../../catalog/connectors.js';
import type { CompletenessResult } from '../../canvas/slots/requiredness.js';
import type { WorkflowCanvasDraft, WorkflowNode } from '../../canvas/draft/schema.js';
import type { NodeDisplayResult, WorkflowCardDisplay } from '../types.js';
import { summaryFromGoalOrCapability, primaryParamValue, truncate } from '../helpers.js';
import { displayActionNode } from './action.js';
import { displayAiDecisionNode } from './ai.js';
import { displayApprovalNode, displayIfNode } from './flow.js';

export function displayForWorkflowNode(
  draft: WorkflowCanvasDraft,
  node: WorkflowNode,
  slots?: CompletenessResult['slots'],
): NodeDisplayResult {
  switch (node.type) {
    case 'action':
      return displayActionNode(draft, node, slots);
    case 'ai_decision':
      return displayAiDecisionNode(node);
    case 'if':
      return displayIfNode(node);
    case 'human_approval':
      return displayApprovalNode(node);
    default:
      return {
        kind: 'action',
        label: '단계',
        lines: [],
        card: {
          header: 'Action',
          brand: 'Step',
          brandStyle: 'bracket',
          summary: '설정 필요',
        },
        incomplete: true,
      };
  }
}

export function displayForCapability(
  capabilityId: string,
  options?: { goal?: string; params?: Record<string, unknown> },
): WorkflowCardDisplay {
  const cap = getCapability(capabilityId);
  if (!cap) {
    return {
      header: 'Action',
      brand: capabilityId,
      brandStyle: 'bracket',
      summary: capabilityId,
    };
  }
  return {
    header: cap.kind === 'trigger' ? 'Trigger' : 'Action',
    brand: getConnectorLabel(cap.connector),
    brandStyle: cap.connector === 'slack' ? 'plain' : 'bracket',
    summary: summaryFromGoalOrCapability(options?.goal, cap, options?.params, 24),
    captionSub: primaryParamValue(cap, options?.params),
  };
}

export function editPromptForNode(draft: WorkflowCanvasDraft, node: WorkflowNode): string {
  const display = displayForWorkflowNode(draft, node);
  return `${display.label} 단계를 어떻게 바꿀까요?`;
}
