import { describe, expect, it } from 'vitest';
import { applyStepBindings } from '../../bindings.js';
import type { WorkflowIR } from '../../schema.js';
describe('structured transform snapshot tables', () => {
  it('groups snapshot bindings into transform tables by source id', () => {
    const ir: WorkflowIR = {
      id: 'wf-multi-source',
      name: 'Multi-source transform',
      goal: '여러 원천 비교',
      version: 1,
      trigger: { type: 'manual' },
      inputs: [],
      steps: [
        { type: 'action', id: 'read-sales', connector: 'rdb', action: 'query.read', params: { table: 'sales' }, sideEffect: 'NONE' },
        { type: 'action', id: 'read-targets', connector: 'rdb', action: 'query.read', params: { table: 'targets' }, sideEffect: 'NONE' },
        {
          type: 'action',
          id: 'evaluate',
          connector: 'transform',
          action: 'evaluate',
          params: {},
          bindings: { table: { from: 'read-sales', output: 'rows' }, 'snapshot.rdb:targets': { from: 'read-targets', output: 'rows' } },
          sideEffect: 'NONE',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };
    const evaluate = ir.steps[2]!;
    if (evaluate.type !== 'action') throw new Error('missing evaluate action');
    const params = applyStepBindings(evaluate, ir, evaluate.params, { 'read-sales': [{ amount: 50 }], 'read-targets': [{ amount: 100 }] }, {});
    expect(params.table).toEqual([{ amount: 50 }]);
    expect(params.tables).toEqual({ 'rdb:targets': [{ amount: 100 }] });
  });
});
