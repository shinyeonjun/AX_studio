import { describe, expect, it, vi } from 'vitest';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import { shapingBackground, withDecisionBackground } from './decision-background.js';

describe('what the person confirmed, as background for table shaping', () => {
  it('adds their confirmed rules to every object-shaped decision state, and nothing without any', async () => {
    const evaluate = vi.fn<DecisionEngine['evaluate']>(async () => ({ answers: {} }));
    const background = shapingBackground({ options: { sessionMemo: { user_rule_1: 'VIP는 grade가 A인 고객' } } as never, session: { workflowPolicy: {} } as never });
    await withDecisionBackground({ evaluate }, background).evaluate({ state: { request: 'VIP만' }, questions: {} });
    expect(evaluate.mock.calls[0]![0].state).toMatchObject({
      request: 'VIP만',
      user_confirmed_preferences: { values: [{ scope: 'session', key: 'user_rule_1', value: 'VIP는 grade가 A인 고객' }] },
    });
    expect(shapingBackground({ options: {} as never, session: {} as never })).toBeUndefined();
    const engine = { evaluate };
    expect(withDecisionBackground(engine, undefined)).toBe(engine);
  });
});
