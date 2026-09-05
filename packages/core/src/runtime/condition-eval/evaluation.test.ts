import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../condition-expr.js';

describe('evaluateCondition', () => {
  it('evaluates declarative comparisons on step results', () => {
    const stepResults = {
      classify: { category: 'critical' },
      analyze: { changeRate: -0.25 },
    };
    expect(
      evaluateCondition(
        { op: 'eq', left: { ref: 'classify.category' }, right: { lit: 'critical' } },
        {},
        stepResults,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { op: 'lte', left: { ref: 'analyze.changeRate' }, right: { lit: -0.2 } },
        {},
        stepResults,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { op: 'eq', left: { ref: 'classify.category' }, right: { lit: 'normal' } },
        {},
        stepResults,
      ),
    ).toBe(false);
  });

  it('supports contains and trigger refs', () => {
    expect(
      evaluateCondition(
        { op: 'contains', left: { ref: 'sender' }, right: { lit: 'plosind@naver.com' } },
        { sender: 'plosind@naver.com' },
        {},
      ),
    ).toBe(true);
  });

  it('does not fall back to trigger variables for explicit null step results', () => {
    expect(
      evaluateCondition(
        { op: 'eq', left: { ref: 'status' }, right: { lit: 'pending' } },
        { status: 'pending' },
        { status: null },
      ),
    ).toBe(false);
  });

  it('fails numeric comparisons closed for missing and non-numeric values', () => {
    for (const value of [null, false, '', 'not-a-number']) {
      expect(
        evaluateCondition(
          { op: 'gte', left: { ref: 'value' }, right: { lit: 0 } },
          { value },
          {},
        ),
      ).toBe(false);
    }
  });

  it('supports numeric strings in numeric comparisons', () => {
    expect(
      evaluateCondition(
        { op: 'gt', left: { ref: 'value' }, right: { lit: 10 } },
        { value: '10.5' },
        {},
      ),
    ).toBe(true);
  });

  it('resolves condition refs through declared output ports', () => {
    expect(
      evaluateCondition(
        { op: 'eq', left: { ref: 'fetch.response.status' }, right: { lit: 200 } },
        {},
        { fetch: { status: 500 } },
        { fetch: { response: { status: 200 } } },
      ),
    ).toBe(true);
  });
});
