import { describe, expect, it } from 'vitest';
import { paramValue } from './helpers.js';

describe('a step parameter on the canvas', () => {
  it('reads as words, never as an object or a template', () => {
    const expr = { op: 'aggregate', fn: 'sum', column: '금액', input: { op: 'source', sourceId: 's' } };
    expect(paramValue({ expr }, 'expr')).toBe('금액 합계');
    expect(paramValue({ path: '{{sourcePath}}' }, 'path')).toBe('실행할 때 채워짐');
    expect(paramValue({ options: { a: 1 } }, 'options')).toBe('설정됨');
    expect(paramValue({ channel: ' #ops ' }, 'channel')).toBe('#ops');
    expect(paramValue({ count: 3 }, 'count')).toBe('3');
  });
});

describe('a saved work opened on the canvas', () => {
  it('keeps a calculation step as a calculation, and describes it', async () => {
    const { buildWorkflowView } = await import('../workflow-view.js');
    const { displayForWorkflowNode } = await import('./node-display/resolve.js');
    const expr = { op: 'aggregate', fn: 'sum', column: '금액', input: { op: 'source', sourceId: 's' } };
    const view = buildWorkflowView({
      id: 'w', version: 1, name: '월간 매출', goal: '월간 매출', trigger: { type: 'manual' },
      steps: [{ type: 'action', id: 'total', connector: 'transform', action: 'evaluate', params: { expr, outputPath: 'field.총매출' } }],
    } as never, 'w');
    expect(view.workflow.actions.total?.params?.expr).toEqual(expr);
    expect(displayForWorkflowNode(view.workflow, view.workflow.nodes[0]!).card?.summary).toBe('금액 합계');
  });
});
