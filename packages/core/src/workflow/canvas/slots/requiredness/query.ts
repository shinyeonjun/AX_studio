import type { CompletenessResult, SlotState } from '../types.js';

export function missingQuestionSlots(result: CompletenessResult): SlotState[] {
  return result.slots.filter((slot) => !slot.filled && slot.question);
}

export function getNextQuestion(result: CompletenessResult): string | null {
  return missingQuestionSlots(result)[0]?.question ?? null;
}
