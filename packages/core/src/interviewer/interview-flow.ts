import type { SkillIR } from '../skill/schema.js';
import { validateApprovalPolicy } from '../skill/approval.js';
import { assessCompleteness, getNextQuestion } from './requiredness.js';
import { buildIRFromDraft } from './draft-builder.js';
import { createInterviewState, type InterviewState } from './interview-state.js';

export function applyAnswer(state: InterviewState, answer: string): InterviewState {
  const missing = state.completeness.missingRequired[0];
  const draft = { ...state.draft } as Partial<SkillIR> & Record<string, unknown>;

  switch (missing) {
    case 'goal':
      draft.goal = answer;
      draft.name = answer.slice(0, 30);
      break;
    case 'trigger':
      if (answer.includes('메일')) draft.trigger = { type: 'gmail.new_message', accountId: 'primary' };
      else if (answer.includes('매') || answer.includes('주') || answer.includes('월'))
        draft.trigger = { type: 'schedule', schedule: '0 9 * * 1', timezone: 'Asia/Seoul' };
      else draft.trigger = { type: 'manual' };
      break;
    case 'trigger.schedule':
      if (draft.trigger?.type === 'schedule') draft.trigger.schedule = answer;
      break;
    case 'trigger.timezone':
      if (draft.trigger?.type === 'schedule') draft.trigger.timezone = answer;
      break;
    case 'gmail.account':
      if (draft.trigger?.type === 'gmail.new_message') draft.trigger.accountId = answer;
      break;
    case 'slack.channel':
      draft.slackChannel = answer.startsWith('#') ? answer : `#${answer}`;
      break;
    case 'local_file.path':
      draft.localFilePath = answer;
      break;
    case 'rdb.connection':
      draft.rdbConnectionId = answer;
      break;
    case 'report.template':
      draft.reportTemplate = answer;
      break;
    case 'approval':
      draft.includeGmailSend = true;
      break;
    case 'completion':
      draft.success = answer;
      break;
    case 'action':
      draft.goal = draft.goal ?? answer;
      break;
    default:
      break;
  }

  const built = buildIRFromDraft(draft);
  const completeness = assessCompleteness(built, ['gmail', 'slack', 'local_sheet', 'rdb', 'report']);
  const approvalErrors = validateApprovalPolicy(built as SkillIR);
  const deployable = completeness.deployable && approvalErrors.length === 0;

  const assistantMsg = deployable
    ? '업무를 이해했습니다. 테스트 실행 후 맡길 수 있습니다.'
    : getNextQuestion(completeness) ?? '추가 정보가 필요합니다.';

  return {
    ...state,
    draft: built,
    completeness: { ...completeness, deployable },
    done: deployable,
    messages: [
      ...state.messages,
      { role: 'user', content: answer },
      { role: 'assistant', content: assistantMsg },
    ],
  };
}

export function startInterview(instruction: string): InterviewState {
  const state = createInterviewState(instruction);
  const built = buildIRFromDraft(state.draft);
  const completeness = assessCompleteness(built);
  const question = getNextQuestion(completeness);
  return {
    ...state,
    draft: built,
    completeness,
    done: false,
    messages: [
      { role: 'user', content: instruction },
      ...(question ? [{ role: 'assistant' as const, content: question }] : []),
    ],
  };
}
