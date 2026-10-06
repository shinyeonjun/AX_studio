import { describe, expect, it } from 'vitest';
import { evaluateCondition, migrateLegacyCondition, normalizeCondition } from '../../condition-expr.js';

describe('evaluateCondition normalization', () => {
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

  it('migrates double-equals shorthand emitted by workflow plans', () => {
    expect(normalizeCondition('classify.riskLevel == critical')).toEqual({
      op: 'eq',
      left: { ref: 'classify.riskLevel' },
      right: { lit: 'critical' },
    });
  });

  it('maps legacy loose == with JS string/number coercion instead of strict equality', () => {
    const numberLiteral = migrateLegacyCondition('order.count == 5')!;
    const stringLiteral = migrateLegacyCondition("order.code == '05'")!;
    const check = (expr: typeof numberLiteral, value: unknown) => evaluateCondition(expr, {}, { order: { count: value, code: value } });
    expect([5, '5', '05', 6, '6', null].map((value) => check(numberLiteral, value)))
      .toEqual([true, true, true, false, false, false]);
    expect([5, '05', '5'].map((value) => check(stringLiteral, value))).toEqual([true, true, false]);
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
});
