import type { WorkflowIR } from '../../workflow/schema.js';
import { validateApprovalPolicy } from '../../workflow/approval.js';
import {
  buildIRFromWorkflow,
  buildLenientIRFromWorkflow,
  UnknownCapabilityError,
} from '../compile/builder.js';
import { validateInterviewDraftGraph } from '../compile/validate-graph.js';
import { assessCompleteness } from '../slots/requiredness.js';
import type { InterviewState } from './state.js';
import { workScopeTriggerIssue, type WorkScope } from './work-scope.js';

function addCompileIssue(
  completeness: ReturnType<typeof assessCompleteness>,
  message: string,
  code: 'unknown_action_contract' | 'connector_unavailable',
): ReturnType<typeof assessCompleteness> {
  const issue = { code, message } as const;
  return {
    ...completeness,
    slots: [
      ...completeness.slots,
      { slot: 'contract.workflow', filled: false, label: '작업', question: message },
    ],
    deployable: false,
    contractIssues: [...(completeness.contractIssues ?? []), issue],
  };
}

function applyWorkScopeCompleteness(
  completeness: ReturnType<typeof assessCompleteness>,
  workScope: WorkScope | undefined,
  triggerType: string | undefined,
): ReturnType<typeof assessCompleteness> {
  const message = workScopeTriggerIssue(workScope, triggerType);
  if (!message || completeness.missingRequired.includes('scope.trigger')) return completeness;
  return {
    ...completeness,
    slots: [
      ...completeness.slots,
      { slot: 'scope.trigger', filled: false, label: '업무 범위', question: message },
    ],
    missingRequired: [...completeness.missingRequired, 'scope.trigger'],
    deployable: false,
  };
}

export function mergeGraphIssues(
  completeness: ReturnType<typeof assessCompleteness>,
  workflow: InterviewState['workflow'],
): ReturnType<typeof assessCompleteness> {
  const graphIssues = validateInterviewDraftGraph(workflow);
  if (graphIssues.length === 0) return completeness;

  const slots = [...completeness.slots];
  for (const issue of graphIssues) {
    slots.push({
      slot: issue.stepId ? `graph.${issue.stepId}` : 'graph.workflow',
      filled: false,
      label: '흐름',
      question: issue.message,
    });
  }

  return {
    ...completeness,
    slots,
    deployable: false,
    contractIssues: [
      ...(completeness.contractIssues ?? []),
      ...graphIssues.map((issue) => ({
        code: 'missing_input_contract' as const,
        stepId: issue.stepId,
        message: issue.message,
      })),
    ],
  };
}

export function assessSessionCompleteness(
  state: InterviewState,
  connectedConnectors: string[],
): ReturnType<typeof assessCompleteness> {
  try {
    if (state.workflow.nodes.length > 0) {
      return applyWorkScopeCompleteness(
        mergeGraphIssues(
          assessCompleteness(buildIRFromWorkflow(state.workflow), connectedConnectors),
          state.workflow,
        ),
        state.workScope,
        state.workflow.triggerType,
      );
    }
  } catch (error) {
    // Lenient compilation is for a conversationally incomplete plan. Graph
    // structure is not a missing value and must remain a hard error.
    if ((error as { code?: string })?.code === 'workflow_graph_invalid') {
      throw error;
    }
    if (state.workflow.nodes.length > 0) {
      const completeness = applyWorkScopeCompleteness(
        mergeGraphIssues(
          assessCompleteness(buildLenientIRFromWorkflow(state.workflow), connectedConnectors),
          state.workflow,
        ),
        state.workScope,
        state.workflow.triggerType,
      );
      if (error instanceof UnknownCapabilityError) {
        return addCompileIssue(completeness, error.message, 'unknown_action_contract');
      }
      return completeness;
    }
  }
  return applyWorkScopeCompleteness(
    mergeGraphIssues(assessCompleteness(state.draft, connectedConnectors), state.workflow),
    state.workScope,
    state.workflow.triggerType,
  );
}

export function finalizeCompleteness(
  built: Partial<WorkflowIR>,
  workflow: InterviewState['workflow'],
  connectedConnectors: string[],
  workScope: WorkScope | undefined,
): {
  completeness: ReturnType<typeof assessCompleteness>;
  deployable: boolean;
} {
  const completeness = applyWorkScopeCompleteness(
    mergeGraphIssues(assessCompleteness(built, connectedConnectors), workflow),
    workScope,
    workflow.triggerType,
  );
  const approvalErrors = validateApprovalPolicy({
    ...built,
    steps: built.steps ?? [],
  } as WorkflowIR);
  const deployable = completeness.deployable && approvalErrors.length === 0;
  return { completeness: { ...completeness, deployable }, deployable };
}
