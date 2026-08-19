import { describe, expect, it } from 'vitest';
import { evaluateStepCondition } from './condition-eval.js';

describe('evaluateStepCondition', () => {
  it('evaluates step result field comparisons', () => {
    const stepResults = {
      classify: { category: 'critical' },
      analyze: { changeRate: -0.25 },
    };
    expect(evaluateStepCondition('classify.category === "critical"', stepResults)).toBe(true);
    expect(evaluateStepCondition('analyze.changeRate <= -0.2', stepResults)).toBe(true);
    expect(evaluateStepCondition('classify.category === "normal"', stepResults)).toBe(false);
  });

  it('rejects unsafe expressions', () => {
    expect(evaluateStepCondition('process.exit()', {})).toBe(false);
  });
});
