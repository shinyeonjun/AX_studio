import type { CompletenessResult } from '../slots/requiredness.js';
import { connectionGuidance, isTriggerRequirementSlot } from '../presentation/panel-fields.js';
import type { WorkScope } from './work-scope.js';
import type { InterviewSessionStatus } from './state.js';

const READY_MESSAGE = '업무 워크플로우를 이렇게 이해했습니다. 아래에서 실행하거나 저장할 수 있습니다.';
const GRAPH_REVIEW_MESSAGE = '오른쪽 그래프에서 빈 칸을 확인한 뒤 검토해 주세요.';

function skipTriggerSlotInChat(workScope: WorkScope): boolean {
  return workScope === 'once';
}

export function chatMissingSlots(completeness: CompletenessResult, workScope: WorkScope): CompletenessResult['slots'] {
  return completeness.slots.filter((slot) => {
    if (slot.filled) return false;
    if (isTriggerRequirementSlot(slot.slot)) {
      return !skipTriggerSlotInChat(workScope);
    }
    if (slot.slot.startsWith('contract.') || slot.slot.startsWith('graph.') || slot.slot === 'scope.trigger') {
      return true;
    }
    return false;
  });
}

function firstChatInterviewQuestion(completeness: CompletenessResult, workScope: WorkScope): string | null {
  return chatMissingSlots(completeness, workScope).find((slot) => slot.question)?.question ?? null;
}

function firstContractQuestion(completeness: CompletenessResult): string | null {
  const issues = [...(completeness.contractIssues ?? [])].sort((left, right) => {
    if (left.code === right.code) return 0;
    if (left.code === 'unknown_action_contract') return -1;
    if (right.code === 'unknown_action_contract') return 1;
    return 0;
  });
  for (const issue of issues) {
    const slot = completeness.slots.find((candidate) => !candidate.filled && candidate.question === issue.message);
    if (slot?.question) return slot.question;
  }
  return completeness.slots.find((slot) => !slot.filled && slot.slot.startsWith('contract.') && slot.question)?.question ?? null;
}

export function buildAssistantMessage(
  // Kept for the public call shape; model-generated questions are intentionally ignored.
  _agentMessage: string,
  completeness: CompletenessResult,
  deployable: boolean,
  workScope: WorkScope,
  codeFallback = '',
): string {
  const connection = connectionGuidance(completeness.missingConnections);
  if (connection) return connection.message;

  if (deployable) {
    return READY_MESSAGE;
  }

  return (codeFallback.trim() || null)
    ?? firstContractQuestion(completeness)
    ?? firstChatInterviewQuestion(completeness, workScope)
    ?? GRAPH_REVIEW_MESSAGE;
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
