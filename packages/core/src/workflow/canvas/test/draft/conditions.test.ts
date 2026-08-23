import { describe, expect, it } from 'vitest';
import { seedIfConditionsFromClassification } from '../../draft/conditions.js';
import { validateCanvasDraftGraph } from '../../compile/validate-graph.js';

describe('seedIfConditionsFromClassification', () => {
  it('infers if_urgent condition from ai_decision enum output', () => {
    const draft = seedIfConditionsFromClassification({
      name: 'PDF 분류',
      goal: 'PDF 긴급도 분류',
      assumptions: [],
      nodes: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '긴급도 분류',
          outputFields: [
            {
              name: 'urgency',
              type: 'string',
              description: '긴급도',
              enumValues: ['긴급', '운영', '일반'],
            },
          ],
        },
        {
          type: 'if',
          id: 'if_urgent',
          thenStepIds: ['slack_urgent'],
          elseStepIds: ['if_ops'],
        },
        { type: 'action', id: 'slack_urgent', actionRef: 'slack.message.send@1' },
        { type: 'if', id: 'if_ops', thenStepIds: ['slack_ops'], elseStepIds: [] },
        { type: 'action', id: 'slack_ops', actionRef: 'slack.message.send@1' },
      ],
      actions: {},
    });

    const ifNode = draft.nodes.find((node) => node.id === 'if_urgent');
    expect(ifNode?.type === 'if' && ifNode.condition).toEqual({
      op: 'eq',
      left: { ref: 'classify.urgency' },
      right: { lit: '긴급' },
    });
    expect(validateCanvasDraftGraph(draft).some((issue) => issue.stepId === 'if_urgent')).toBe(false);
  });
});
