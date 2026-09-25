import { describe, expect, it } from 'vitest';
import { MAX_WORKFLOW_SERIALIZED_CHARS, MAX_WORKFLOW_STEPS, parseWorkflowIR, validateWorkflowIR } from './schema.js';

describe('workflow IR safety boundary', () => {
  it('does not add a hidden read ceiling and accepts an explicit workflow budget', () => {
    const adaptive = parseWorkflowIR({
      name: 'adaptive', goal: '필요한 데이터를 조사한다',
      steps: [{ type: 'ai_decision', id: 'inspect', goal: '조사', investigation: true }],
    });
    const bounded = parseWorkflowIR({
      name: 'bounded', goal: '명시한 예산만 조사한다',
      steps: [{ type: 'ai_decision', id: 'inspect', goal: '조사', investigation: true, maxReads: 7 }],
    });

    expect(adaptive.steps[0]).not.toHaveProperty('maxReads');
    expect(bounded.steps[0]).toHaveProperty('maxReads', 7);
  });

  it('rejects an oversized executable graph before runtime evaluation', () => {
    const steps = Array.from({ length: MAX_WORKFLOW_STEPS + 1 }, (_, index) => ({
      type: 'action' as const,
      id: `step_${index}`,
      connector: 'slack',
      action: 'message.send',
      params: { channel: '#ops', text: 'bounded' },
      sideEffect: 'EXTERNAL' as const,
    }));

    expect(() => parseWorkflowIR({ name: 'too many', goal: 'bounded', steps })).toThrow();
  });

  it('reports an oversized serialized payload through the safe validator', () => {
    const result = validateWorkflowIR({
      name: 'too large',
      goal: 'x'.repeat(MAX_WORKFLOW_SERIALIZED_CHARS),
      steps: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('workflow payload가 너무 큽니다');
  });
});
