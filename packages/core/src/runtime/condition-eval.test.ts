import { describe, expect, it } from 'vitest';
import { coerceConditionInput, evaluateCondition, migrateLegacyCondition, normalizeCondition, preprocessConditionValue } from './condition-expr.js';

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

  it('coerces and/or with left-right into args', () => {
    expect(
      normalizeCondition({
        op: 'and',
        left: { op: 'contains', left: { ref: 'from' }, right: { lit: 'naver.com' } },
        right: { op: 'contains', left: { ref: 'subject' }, right: { lit: '안내' } },
      }),
    ).toEqual({
      op: 'and',
      args: [
        { op: 'contains', left: { ref: 'from' }, right: { lit: 'naver.com' } },
        { op: 'contains', left: { ref: 'subject' }, right: { lit: '안내' } },
      ],
    });
  });

  it('coerces string-encoded trigger filters from interview output', () => {
    const coerced = coerceConditionInput(
      '{"op":"and","left":{"op":"eq","left":{"ref":"from"},"right":{"lit":"plosind@naver.com"}},"right":{"op":"contains","left":{"ref":"subject"},"right":{"lit":"네이버"}}}',
    );
    expect(normalizeCondition(coerced)).toEqual({
      op: 'and',
      args: [
        { op: 'eq', left: { ref: 'from' }, right: { lit: 'plosind@naver.com' } },
        { op: 'contains', left: { ref: 'subject' }, right: { lit: '네이버' } },
      ],
    });
  });

  it('coerces field/value trigger filters from interview output', () => {
    expect(
      normalizeCondition({
        op: 'contains',
        field: 'from',
        value: 'naver.com',
      }),
    ).toEqual({
      op: 'contains',
      left: { ref: 'from' },
      right: { lit: 'naver.com' },
    });
  });

  it('coerces operator alias and includes op', () => {
    expect(
      normalizeCondition({
        operator: 'includes',
        left: 'subject',
        right: '안내',
      }),
    ).toEqual({
      op: 'contains',
      left: { ref: 'subject' },
      right: { lit: '안내' },
    });
  });

  it('preprocessConditionValue drops invalid filters without throwing', () => {
    expect(preprocessConditionValue({ op: 'weird', left: 'x', right: 'y' })).toBeUndefined();
  });
});
