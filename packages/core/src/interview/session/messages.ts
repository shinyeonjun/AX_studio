import type { CompletenessResult } from '../slots/requiredness.js';
import { getNextQuestion } from '../slots/requiredness.js';
import { connectionGuidance, isTriggerRequirementSlot } from '../presentation/panel-fields.js';
import type { WorkScope } from './work-scope.js';
import type { InterviewSessionStatus } from './state.js';

const READY_MESSAGE = '업무 워크플로우를 이렇게 이해했습니다. 아래에서 실행하거나 저장할 수 있습니다.';

function skipTriggerSlotInChat(workScope: WorkScope): boolean {
  return workScope === 'once';
}

function firstChatInterviewQuestion(completeness: CompletenessResult, workScope: WorkScope): string | null {
  for (const slot of completeness.slots) {
    if (!slot.filled && slot.question) {
      if (isTriggerRequirementSlot(slot.slot) && skipTriggerSlotInChat(workScope)) continue;
      return slot.question;
    }
  }
  return null;
}

function isReviewOrRunConfirmation(nextQuestion: string): boolean {
  const question = nextQuestion.trim();
  if (!question) return false;
  return /실행할까|지금\s*실행|맡길\s*수|검토\s*후|이\s*구성|아래\s*에서|확인\s*해\s*주|진행할까|이대로|저장하면\s*실행/.test(question);
}

function usableNextQuestion(nextQuestion: string): string {
  const trimmed = nextQuestion.trim();
  if (!trimmed || isReviewOrRunConfirmation(trimmed)) return '';
  return trimmed;
}

function interviewMessage(
  completeness: CompletenessResult,
  nextQuestion: string,
  workScope: WorkScope,
): string {
  const connection = connectionGuidance(completeness.missingConnections);
  if (connection) return connection.message;

  const trimmed = usableNextQuestion(nextQuestion);
  if (trimmed) return trimmed;

  return firstChatInterviewQuestion(completeness, workScope) ?? getNextQuestion(completeness) ?? READY_MESSAGE;
}

export function buildAssistantMessage(
  nextQuestion: string,
  completeness: CompletenessResult,
  deployable: boolean,
  workScope: WorkScope,
): string {
  if (!deployable) {
    return interviewMessage(completeness, nextQuestion, workScope);
  }
  return nextQuestion.trim() || READY_MESSAGE;
}

export function isRunConfirmationMessage(content: string): boolean {
  return isReviewOrRunConfirmation(content);
}

export function sessionStatus(
  deployable: boolean,
  finalized: boolean,
  hasPlan: boolean,
): InterviewSessionStatus {
  if (finalized) return 'done';
  if (deployable) return 'ready';
  if (hasPlan) return 'planning';
  return 'collecting';
}
