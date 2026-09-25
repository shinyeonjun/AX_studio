import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../contracts/decision.js';
import type { Step } from '../../workflow/schema.js';
import { planDecisionOutputs } from './decision-outputs.js';

const decisionEngine: DecisionEngine = { evaluate: async () => ({ answers: {} }) };

function planFor(field: Record<string, unknown>) {
  const step: Extract<Step, { type: 'ai_decision' }> = {
    type: 'ai_decision',
    id: 'classify',
    goal: 'Classify the input',
    outputSchema: { type: 'object', properties: { result: field } },
    investigation: false,
    maxReads: 1,
  };
  return planDecisionOutputs(step, decisionEngine);
}

describe('AI decision output routing', () => {
  it('does not route enum choices whose values contradict the declared type', () => {
    const plan = planFor({ type: 'string', enum: [1, 2] });

    expect(plan.jevUnavailableFields).toEqual(['result']);
    expect(plan.questions).toEqual({});
  });

  it('does not route a boolean enum that permits only one boolean value', () => {
    const plan = planFor({ type: 'boolean', enum: [true] });

    expect(plan.jevUnavailableFields).toEqual(['result']);
    expect(plan.questions).toEqual({});
  });

  it('routes a well-typed finite numeric enum to Jev', () => {
    const plan = planFor({ type: 'integer', enum: [1, 2] });

    expect(plan.jevUnavailableFields).toEqual([]);
    expect(plan.questions.output_0?.type).toBe('choice');
  });

  it('routes boolean outputs as an explicit true/false/unclear choice', () => {
    const plan = planFor({ type: 'boolean' });

    expect(plan.questions.output_0).toMatchObject({
      type: 'choice',
      criteria: {
        true: expect.any(String),
        false: expect.any(String),
        unclear: expect.any(String),
      },
    });
  });
});
