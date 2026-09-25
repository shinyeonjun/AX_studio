import type { DecisionEngine, DecisionEvaluationResult } from '../../../../contracts/decision.js';

/** Deterministically plans Gmail event → read → generated text → Slack action. */
export function gmailToSlackRecurringDecisionEngine(): DecisionEngine {
  const stepCriteria = [
    'gmail.messages.read',
    '"step_type":"ai_decision"',
    'slack.message.send',
  ];
  let stepIndex = 0;

  return {
    evaluate: async ({ questions }): Promise<DecisionEvaluationResult> => {
      if (questions.route) {
        const trigger = Object.entries(questions.workflow_trigger?.type === 'choice'
          ? questions.workflow_trigger.criteria
          : {}).find(([, criterion]) => JSON.stringify(criterion).includes('gmail.new_message'))?.[0];
        if (!trigger) throw new Error('gmail_event_trigger_not_offered');
        return { answers: {
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

      const binding = questions.input_0;
      if (binding?.type === 'choice') {
        const source = Object.entries(binding.criteria).find(([, criterion]) =>
          JSON.stringify(criterion).includes('jev_step_2'))?.[0];
        if (!source) throw new Error('generated_text_binding_not_offered');
        return { answers: { input_0: {
          type: 'choice', choice: source,
          probabilities: { [source]: 0.99, none: 0.01 }, confidence: 0.99,
        } } };
      }

      const next = questions.next_step;
      if (next?.type !== 'choice') throw new Error('workflow_step_choice_not_offered');
      const target = stepCriteria[stepIndex];
      const selected = target
        ? Object.entries(next.criteria).find(([, criterion]) => JSON.stringify(criterion).includes(target))
        : undefined;
      if (selected) stepIndex += 1;
      const choice = selected?.[0] ?? 'done';
      return { answers: { next_step: {
        type: 'choice', choice,
        probabilities: { [choice]: 0.99, done: selected ? 0.01 : 0.99 }, confidence: 0.99,
      } } };
    },
  };
}
