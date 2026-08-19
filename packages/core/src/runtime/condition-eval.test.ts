import { describe, expect, it } from 'vitest';
import { evaluateCondition, migrateLegacyCondition, normalizeCondition } from './condition-expr.js';

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

  it('migrates legacy string conditions', () => {
    const migrated = migrateLegacyCondition('classify.category === "critical"');
    expect(migrated).toEqual({
      op: 'eq',
      left: { ref: 'classify.category' },
      right: { lit: 'critical' },
    });
    expect(normalizeCondition("String(sender).includes('plosind@naver.com')")).toEqual({
      op: 'contains',
      left: { ref: 'sender' },
      right: { lit: 'plosind@naver.com' },
    });
  });
});
