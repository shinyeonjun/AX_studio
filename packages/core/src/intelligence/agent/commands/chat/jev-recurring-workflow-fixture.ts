import type { DecisionEngine, DecisionEvaluationResult } from '../../../../contracts/decision.js';
import { parallelToolAnswersForTest } from './fixtures.js';

/** Selects a Gmail read and Slack send tool for a recurring Gmail workflow. */
export function gmailToSlackRecurringDecisionEngine(): DecisionEngine {
  return {
    evaluate: async (request): Promise<DecisionEvaluationResult> => {
      const { questions } = request;
      if (questions.route) {
        const trigger = Object.entries(questions.workflow_trigger?.type === 'choice'
          ? questions.workflow_trigger.criteria
          : {}).find(([, criterion]) => JSON.stringify(criterion).includes('gmail.new_message'))?.[0];
        if (!trigger) throw new Error('gmail_event_trigger_not_offered');
        return { answers: {
          ...parallelToolAnswersForTest(request, {
            needsNaturalLanguageAnswer: false,
            select: (candidate) => ['gmail.messages.read', 'slack.message.send'].includes(candidate.capabilityId ?? ''),
          }),
          route: {
            type: 'choice', choice: 'job_propose',
            probabilities: { job_propose: 0.99, answer: 0.01 }, confidence: 0.99,
          },
          workflow_trigger: {
            type: 'choice', choice: trigger,
            probabilities: { [trigger]: 0.99, none: 0.01 }, confidence: 0.99,
          },
        } };
      }

      throw new Error('unexpected_recurring_workflow_field_selection');
    },
  };
}
