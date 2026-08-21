import type { CompletenessResult } from '../slots/requiredness.js';
import { getNextQuestion } from '../slots/requiredness.js';
import { connectionGuidance, isTriggerRequirementSlot } from '../presentation/panel-fields.js';
import type { WorkScope } from './work-scope.js';
import type { InterviewSessionStatus } from './state.js';

const READY_MESSAGE = '업무 워크플로우를 이렇게 이해했습니다. 아래에서 실행하거나 저장할 수 있습니다.';

function skipTriggerSlotInChat(workScope: WorkScope): boolean {
  return workScope === 'once';
}

export function chatMissingSlots(completeness: CompletenessResult, workScope: WorkScope): CompletenessResult['slots'] {
  return completeness.slots.filter((slot) => {
    if (slot.filled) return false;
    if (isTriggerRequirementSlot(slot.slot) && skipTriggerSlotInChat(workScope)) return false;
    return true;
  });
}

function firstChatInterviewQuestion(completeness: CompletenessResult, workScope: WorkScope): string | null {
  return chatMissingSlots(completeness, workScope).find((slot) => slot.question)?.question ?? null;
}

export function buildAssistantMessage(
  nextQuestion: string,
  completeness: CompletenessResult,
  deployable: boolean,
  workScope: WorkScope,
): string {
  const connection = connectionGuidance(completeness.missingConnections);
  if (connection) return connection.message;

  if (deployable) {
    return READY_MESSAGE;
  }

  const provided = nextQuestion.trim();
  if (provided && completeness.contractIssues?.length) {
    return provided;
  }

  return firstChatInterviewQuestion(completeness, workScope) ?? getNextQuestion(completeness) ?? READY_MESSAGE;
}

export function shouldFinalizeInterview(deployable: boolean): boolean {
  return deployable;
}

export function isRunConfirmationMessage(content: string): boolean {
  return content.trim() === READY_MESSAGE;
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
