import { describe, expect, it } from 'vitest';
import { coerceConditionInput, normalizeCondition } from '../../condition-expr.js';
describe('evaluateCondition normalization', () => {
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

  it('coerces variable/value if conditions from interview output', () => {
    expect(
      normalizeCondition({
        variable: 'classify.riskLevel',
        comparator: '==',
        value: 'critical',
      }),
    ).toEqual({
      op: 'eq',
      left: { ref: 'classify.riskLevel' },
      right: { lit: 'critical' },
    });
  });

  it('coerces wrapped expression strings', () => {
    expect(
      normalizeCondition({
        expression: 'classify.riskLevel == critical',
      }),
    ).toEqual({
      op: 'eq',
      left: { ref: 'classify.riskLevel' },
      right: { lit: 'critical' },
    });
  });

  it('coerces equals array and ref/eq shorthand', () => {
    expect(
      normalizeCondition({
        equals: ['classify.urgency', '긴급'],
      }),
    ).toEqual({
      op: 'eq',
      left: { ref: 'classify.urgency' },
      right: { lit: '긴급' },
    });
    expect(
      normalizeCondition({
        ref: 'classify.urgency',
        eq: '긴급',
      }),
    ).toEqual({
      op: 'eq',
      left: { ref: 'classify.urgency' },
      right: { lit: '긴급' },
    });
    expect(
      normalizeCondition({
        when: { field: 'classify.urgency', value: '긴급' },
      }),
    ).toEqual({
      op: 'eq',
      left: { ref: 'classify.urgency' },
      right: { lit: '긴급' },
    });
  });
});
