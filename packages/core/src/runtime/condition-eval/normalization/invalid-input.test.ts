import { describe, expect, it } from 'vitest';
import { preprocessConditionValue } from '../../condition-expr.js';

describe('evaluateCondition normalization', () => {
  it('preprocessConditionValue drops invalid filters without throwing', () => {
    expect(preprocessConditionValue({ op: 'weird', left: 'x', right: 'y' })).toBeUndefined();
  });
});
