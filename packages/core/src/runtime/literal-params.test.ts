import { describe, expect, it } from 'vitest';
import type { ConnectorContext } from '../connectors/types.js';
import { executeTransformAction } from '../connectors/transform/connector/execute.js';
import { buildTableArtifact } from '../contracts/artifacts/table-build.js';
import type { TableArtifact } from '../contracts/artifacts/table.js';
import type { TransformExpr } from '../workflow/transform-expr/dsl.js';
import { validateWorkflowIR, type WorkflowIR } from '../workflow/schema.js';
import { resolveActionParamsForExecution } from './step-executor.js';

/** Expressions with column references, nested conditions and template-looking literals. */
const EXPRESSIONS: Array<[string, TransformExpr]> = [
  ['a column filter', { op: 'filter', input: { op: 'source', sourceId: 'src' }, where: { op: 'lt', left: { ref: 'stock' }, right: { lit: 10 } } }],
  ['nested conditions', {
    op: 'filter', input: { op: 'source', sourceId: 'src' },
    where: { op: 'and', args: [
      { op: 'neq', left: { ref: '상태' }, right: { lit: '취소' } },
      { op: 'not', arg: { op: 'eq', left: { ref: 'stock' }, right: { lit: 0 } } },
    ] },
  }],
  ['a template-looking literal', { op: 'filter', input: { op: 'source', sourceId: 'src' }, where: { op: 'eq', left: { ref: '상태' }, right: { lit: '{{secret}}' } } }],
  ['a grouped report with a filter', {
    op: 'group', input: { op: 'filter', input: { op: 'source', sourceId: 'src' }, where: { op: 'neq', left: { ref: '상태' }, right: { lit: '취소' } } },
    by: '상태', aggregates: [{ as: '재고 합계', fn: 'sum', column: 'stock' }],
  }],
];

function workflowWith(expr: TransformExpr): WorkflowIR {
  const parsed = validateWorkflowIR({
    version: 1, name: '재고', goal: '재고 표', trigger: { type: 'manual' },
    steps: [{ type: 'action', id: 'shape', connector: 'transform', action: 'evaluate', params: { expr, discoverySourceId: 'src', outputPath: 'result' }, sideEffect: 'NONE' }],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe('literal params at run time', () => {
  const table: TableArtifact = buildTableArtifact({
    id: 'src', headers: ['title', '상태', 'stock'],
    matrix: [['a', '완료', 3], ['b', '취소', 1], ['c', '완료', 0], ['d', '보류', 20]],
  });

  it.each(EXPRESSIONS)('passes %s to the transform unchanged and evaluates it', async (_name, expr) => {
    const ir = workflowWith(expr);
    const step = ir.steps[0] as Extract<WorkflowIR['steps'][number], { type: 'action' }>;
    const ctx: ConnectorContext = { executionId: 'exec-1', variables: { secret: 'LEAKED' }, log: () => {} };
    const { params } = resolveActionParamsForExecution(step, ir, ctx, {});
    expect(params.expr).toEqual(expr);
    const result = await executeTransformAction('evaluate', { ...params, table }, ctx);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(JSON.stringify(result.data)).not.toContain('LEAKED');
  });

  it('still resolves templates in ordinary params', () => {
    const parsed = validateWorkflowIR({
      version: 1, name: 'x', goal: 'x', trigger: { type: 'manual' },
      steps: [{ type: 'action', id: 'fetch', connector: 'http', action: 'request', params: { method: 'GET', path: '{{path}}' }, sideEffect: 'NONE' }],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const step = parsed.value.steps[0] as Extract<WorkflowIR['steps'][number], { type: 'action' }>;
    const ctx: ConnectorContext = { executionId: 'exec-1', variables: { path: 'products' }, log: () => {} };
    expect(resolveActionParamsForExecution(step, parsed.value, ctx, {}).params.path).toBe('products');
  });
});
