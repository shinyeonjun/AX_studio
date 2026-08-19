import type { WorkflowIR } from '../workflow/schema.js';
import type { AgentHarness } from '../agent/harness.js';
import { normalizeWorkflowActionNode } from '../connectors/capability-graph.js';
import { validateApprovalPolicy } from '../workflow/approval.js';
import { assessCompleteness, getNextQuestion } from './requiredness.js';
import { buildIRFromWorkflow, UnknownCapabilityError } from './workflow-builder.js';
import { createInterviewState, type InterviewState } from './interview-state.js';
import { InterviewDraftSchema, InterviewTurnSchema, type InterviewDraft, type InterviewTurn } from './workflow-schema.js';
import { windowInterviewMessages } from '../agent/prompt-context.js';

export interface InterviewRunOptions {
  harness: AgentHarness;
  connectedConnectors?: string[];
  onProgress?: (event: { message: string }) => void;
}

function draftFromTurn(turn: InterviewTurn): InterviewDraft {
  const { nextQuestion: _nextQuestion, ...draft } = turn;
  return InterviewDraftSchema.parse(draft);
}

async function runInterviewTurn(state: InterviewState, options: InterviewRunOptions): Promise<InterviewState> {
  const connectedConnectors = options.connectedConnectors ?? [];
  const priorCompleteness = assessCompleteness(state.draft, connectedConnectors);
  const { output } = await options.harness.run({
    role: 'interview',
    outputSchema: InterviewTurnSchema,
    context: {
      workflow: state.workflow,
      completeness: priorCompleteness,
      connectedConnectors,
      nowIso: new Date().toISOString(),
    },
    sessionId: state.sessionId,
    onProgress: options.onProgress,
    messages: windowInterviewMessages(state.messages),
  });
  const turn = InterviewTurnSchema.parse(output);

  const workflowDraft = draftFromTurn(turn);
  const workflow = {
    ...workflowDraft,
    nodes: workflowDraft.nodes.map(normalizeWorkflowActionNode),
  };
  let built: ReturnType<typeof buildIRFromWorkflow>;
  try {
    built = buildIRFromWorkflow(workflow);
  } catch (err) {
    const message =
      err instanceof UnknownCapabilityError
        ? err.message
        : err instanceof Error
          ? err.message
          : '워크플로우를 컴파일할 수 없습니다.';
    return {
      ...state,
      workflow,
      completeness: { ...priorCompleteness, deployable: false },
      done: false,
      messages: [...state.messages, { role: 'assistant', content: message }],
    };
  }
  const completeness = assessCompleteness(built, connectedConnectors);
  const approvalErrors = validateApprovalPolicy({
    ...built,
    steps: built.steps ?? [],
  } as WorkflowIR);
  const deployable = completeness.deployable && approvalErrors.length === 0;
  const assistantMsg = deployable
    ? turn.nextQuestion.trim() || '업무 워크플로우를 이렇게 이해했습니다. 검토 후 맡길 수 있습니다.'
    : turn.nextQuestion.trim() || getNextQuestion(completeness) || '추가 정보가 필요합니다.';

  return {
    ...state,
    workflow,
    draft: built,
    completeness: { ...completeness, deployable },
    done: deployable,
    messages: [...state.messages, { role: 'assistant', content: assistantMsg }],
  };
}

export async function startInterview(
  instruction: string,
  options: InterviewRunOptions,
): Promise<InterviewState> {
  const state = createInterviewState(instruction.trim());
  return runInterviewTurn(state, options);
}

export async function applyAnswer(
  state: InterviewState,
  answer: string,
  options: InterviewRunOptions,
): Promise<InterviewState> {
  const next: InterviewState = {
    ...state,
    messages: [...state.messages, { role: 'user', content: answer.trim() }],
  };
  return runInterviewTurn(next, options);
}
