import type { SkillIR } from '../skill/schema.js';
import type { ModelProvider } from '../models/provider.js';
import { validateApprovalPolicy } from '../skill/approval.js';
import { assessCompleteness, getNextQuestion } from './requiredness.js';
import { buildIRFromWorkflow } from './workflow-builder.js';
import { createInterviewState, type InterviewState } from './interview-state.js';
import { buildInterviewSystemPrompt } from './interview-prompt.js';
import { InterviewDraftSchema, InterviewTurnSchema, type InterviewDraft, type InterviewTurn } from './workflow-schema.js';

export interface InterviewRunOptions {
  model: ModelProvider;
  connectedConnectors?: string[];
}

function draftFromTurn(turn: InterviewTurn): InterviewDraft {
  const { nextQuestion: _nextQuestion, ...draft } = turn;
  return InterviewDraftSchema.parse(draft);
}

async function runInterviewTurn(state: InterviewState, options: InterviewRunOptions): Promise<InterviewState> {
  if (!options.model) {
    throw new Error('인터뷰에는 AI가 필요합니다. 설정에서 AI를 연결하세요.');
  }

  const connectedConnectors = options.connectedConnectors ?? [];
  const priorCompleteness = assessCompleteness(state.draft, connectedConnectors);
  const turn = InterviewTurnSchema.parse(
    await options.model.generateStructured({
      schema: InterviewTurnSchema,
      system: buildInterviewSystemPrompt({
        workflow: state.workflow,
        completeness: priorCompleteness,
        connectedConnectors,
        nowIso: new Date().toISOString(),
      }),
      messages: state.messages,
      temperature: 0.2,
    }),
  );

  const workflow = draftFromTurn(turn);
  const built = buildIRFromWorkflow(workflow);
  const completeness = assessCompleteness(built, connectedConnectors);
  const approvalErrors = validateApprovalPolicy({
    ...built,
    steps: built.steps ?? [],
  } as SkillIR);
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
