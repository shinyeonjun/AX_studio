import type { SkillIR } from '../skill/schema.js';
import { assessCompleteness, type CompletenessResult } from './requiredness.js';

export interface InterviewState {
  userInstruction: string;
  draft: Partial<SkillIR>;
  completeness: CompletenessResult;
  done: boolean;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export function createInterviewState(instruction: string): InterviewState {
  const draft: Partial<SkillIR> = {
    name: '새 업무',
    goal: instruction,
    steps: [],
    assumptions: [],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    dataPolicy: { emailBody: { cloudAllowed: false } },
  };
  const completeness = assessCompleteness(draft);
  return {
    userInstruction: instruction,
    draft,
    completeness,
    done: completeness.deployable,
    messages: [{ role: 'user', content: instruction }],
  };
}
