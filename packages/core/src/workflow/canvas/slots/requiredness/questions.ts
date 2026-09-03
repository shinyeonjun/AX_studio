import { requirementCopy, type RequirementQuestionKey } from '../../../../i18n/ko.js';

export const CORE_QUESTIONS: Record<RequirementQuestionKey, { label: string; question: string }> = {
  goal: requirementCopy('goal'),
  trigger: requirementCopy('trigger'),
  'trigger.schedule': requirementCopy('trigger.schedule'),
  'trigger.timezone': requirementCopy('trigger.timezone'),
  'trigger.runAt': requirementCopy('trigger.runAt'),
  action: requirementCopy('action'),
  approval: requirementCopy('approval'),
  completion: requirementCopy('completion'),
  'ai_decision.goal': requirementCopy('ai_decision.goal'),
  'ai_decision.schema': requirementCopy('ai_decision.schema'),
  'human_approval.reason': requirementCopy('human_approval.reason'),
};
