import type { WorkflowIR } from '../workflow/schema.js';
import type { AgentHarness } from '../agent/harness.js';
import { normalizeWorkflowActionNode } from '../catalog/capability-graph.js';
import { validateApprovalPolicy } from '../workflow/approval.js';
import { buildConnectedResourcesFromConnections } from './connected-resources.js';
import { resolveInterviewDraftDefaults } from './draft-defaults.js';
import { runInterviewDiscoveryLoop } from './interview-discovery.js';
import { createInterviewState, type InterviewState } from './interview-state.js';
import { InterviewDraftSchema, type InterviewDraft, type InterviewTurn } from './workflow-schema.js';
import { windowInterviewMessages } from '../agent/prompt-context.js';
import type { DesignToolContext } from '../design-tools/types.js';
import { assessCompleteness, getNextQuestion } from './requiredness.js';
import { buildIRFromWorkflow, UnknownCapabilityError } from './workflow-builder.js';

export interface InterviewRunOptions {
  harness: AgentHarness;
  connectedConnectors?: string[];
  designToolContext: DesignToolContext;
  onProgress?: (event: { message: string }) => void;
}

function draftFromTurn(turn: InterviewTurn): InterviewDraft {
  const { nextQuestion: _nextQuestion, ...draft } = turn;
  return InterviewDraftSchema.parse(draft);
}

function isOpenInterviewQuestion(nextQuestion: string): boolean {
  const question = nextQuestion.trim();
  if (!question) return false;
  if (question.includes('?')) return true;
  if (/알려\s*(주|줘)|말씀\s*해|입력\s*해|선택\s*해/.test(question)) return true;
  return false;
}

async function runInterviewTurn(state: InterviewState, options: InterviewRunOptions): Promise<InterviewState> {
  const connectedConnectors = options.connectedConnectors ?? [];
  const priorCompleteness = assessCompleteness(state.draft, connectedConnectors);

  const turn = await runInterviewDiscoveryLoop({
    harness: options.harness,
    designToolContext: options.designToolContext,
    sessionId: state.sessionId,
    onProgress: options.onProgress,
    messages: windowInterviewMessages(state.messages),
    context: {
      workflow: state.workflow,
      completeness: priorCompleteness,
      connectedConnectors,
      nowIso: new Date().toISOString(),
    },
  });

  const connectedResources = buildConnectedResourcesFromConnections(options.designToolContext.connections);
  const workflowDraft = draftFromTurn(turn);
  const workflow = resolveInterviewDraftDefaults(
    {
      ...workflowDraft,
      nodes: workflowDraft.nodes.map(normalizeWorkflowActionNode),
    },
    connectedResources,
    { userInstruction: state.userInstruction },
  );

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
  const openQuestion = isOpenInterviewQuestion(turn.nextQuestion);
  const finalized = deployable && !openQuestion;
  const assistantMsg = finalized
    ? turn.nextQuestion.trim() || '업무 워크플로우를 이렇게 이해했습니다. 검토 후 맡길 수 있습니다.'
    : turn.nextQuestion.trim() || getNextQuestion(completeness) || '추가 정보가 필요합니다.';

  return {
    ...state,
    workflow,
    draft: built,
    completeness: { ...completeness, deployable },
    done: finalized,
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
