import {
  aiDecisionOutputPorts,
  resolveCapability,
  stepOutputPorts,
  triggerOutputPorts,
} from '@ax-studio/core';
import type { AxCore } from '../../core-instance.js';

type StoredWorkflow = NonNullable<ReturnType<AxCore['store']['getWorkflow']>>;

/** Validates the renderer-supplied ids; returns the trimmed workspace session id. */
export function validatedWorkspaceSessionId(workflowId: unknown, workspaceSessionId: unknown): string {
  if (workflowId !== undefined && (typeof workflowId !== 'string' || !workflowId.trim())) {
    throw new Error('workflow id 형식이 올바르지 않습니다.');
  }
  if (typeof workspaceSessionId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceSessionId.trim())) {
    throw new Error('대화 세션 id 형식이 올바르지 않습니다.');
  }
  return workspaceSessionId.trim();
}

/** The only chat option is the registered HTTP metadata lane; anything else is rejected. */
export function requestsMetadataLane(chatOptions: unknown): boolean {
  if (chatOptions !== undefined && (!chatOptions || typeof chatOptions !== 'object' || Array.isArray(chatOptions))) throw new Error('workspace_chat_invalid_lane');
  const preferences = (chatOptions ?? {}) as Record<string, unknown>;
  if (Object.keys(preferences).some(key => key !== 'metadataLane')
    || (preferences.metadataLane !== undefined && preferences.metadataLane !== 'registered_http_metadata')) throw new Error('workspace_chat_invalid_lane');
  return preferences.metadataLane === 'registered_http_metadata';
}

export function currentWorkflowSteps(workflow: StoredWorkflow | null | undefined) {
  return workflow?.steps.map((step) => ({
    id: step.id,
    type: step.type,
    label: step.type === 'action'
      ? `${step.connector} / ${step.action}`
      : step.type === 'ai_decision'
        ? `AI 판단 / ${step.goal}`
        : step.type === 'human_approval'
          ? `승인 / ${step.reason}`
          : '조건 분기',
  }));
}

/** Outputs a workflow update may bind to: the trigger's and every step's typed ports. */
export function currentWorkflowOutputs(workflow: StoredWorkflow | null | undefined) {
  return workflow ? [
    ...triggerOutputPorts(workflow.trigger).map(({ from, port, type }) => ({
      from,
      output: port,
      type,
      capabilityId: `workflow.trigger.${workflow.trigger?.type ?? 'unknown'}`,
    })),
    ...workflow.steps.flatMap((step) => {
      const outputs = step.type === 'action'
        ? stepOutputPorts(step)
        : step.type === 'ai_decision'
          ? aiDecisionOutputPorts(step)
          : [];
      const capabilityId = step.type === 'action'
        ? resolveCapability(step.connector, step.action)?.id ?? 'workflow.action'
        : 'workflow.ai_decision';
      return outputs.map(({ from, port, type }) => ({ from, output: port, type, capabilityId }));
    }),
  ] : undefined;
}
