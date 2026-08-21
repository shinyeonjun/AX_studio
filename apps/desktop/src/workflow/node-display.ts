import type { CompletenessResult, InterviewDraft, WorkflowNode } from '@ax-studio/core';
import {
  displayForCapability as coreDisplayForCapability,
  displayForTrigger as coreDisplayForTrigger,
  displayForWorkflowNode as coreDisplayForWorkflowNode,
  editPromptForNode,
  editPromptForTrigger,
  type WorkflowCardBrandStyle,
  type WorkflowCardDisplay,
  type WorkflowVisualLine,
} from '@ax-studio/core/visual-display';
import { applyWorkflowNodeIcon, triggerIconConnector, triggerNodeIcon, workflowNodeIcon } from './workflow-icons.js';

export type { WorkflowCardBrandStyle, WorkflowCardDisplay, WorkflowVisualLine };
export { editPromptForNode, editPromptForTrigger };

export function displayForTrigger(draft: InterviewDraft, slots?: CompletenessResult['slots']) {
  const base = coreDisplayForTrigger(draft, slots);
  const connector = base.iconConnector ?? triggerIconConnector(draft.triggerType);
  if (connector) return applyWorkflowNodeIcon(base, connector);
  const icon = triggerNodeIcon(draft.triggerType);
  const { iconConnector: _iconConnector, ...rest } = base;
  return { ...rest, iconSrc: icon.src, iconEmoji: icon.emoji };
}

export function displayForWorkflowNode(
  draft: InterviewDraft,
  node: WorkflowNode,
  slots?: CompletenessResult['slots'],
) {
  const base = coreDisplayForWorkflowNode(draft, node, slots);
  if (base.kind === 'ai_decision') {
    const { iconConnector: _iconConnector, ...rest } = base;
    return { ...rest, iconEmoji: '✦' };
  }
  if (base.kind === 'if') {
    const { iconConnector: _iconConnector, ...rest } = base;
    return { ...rest, iconEmoji: '◇' };
  }
  if (base.kind === 'human_approval') {
    const { iconConnector: _iconConnector, ...rest } = base;
    return { ...rest, iconEmoji: '◆' };
  }
  return applyWorkflowNodeIcon(base, node.connector);
}

export function displayForCapability(
  capabilityId: string,
  options?: { goal?: string; params?: Record<string, unknown> },
) {
  const base = coreDisplayForCapability(capabilityId, options);
  const cap = capabilityId.split('.')[0];
  const icon = workflowNodeIcon(cap);
  return { ...base, iconSrc: icon.src, iconEmoji: icon.emoji };
}
