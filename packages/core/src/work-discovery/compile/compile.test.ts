import { describe, expect, it } from 'vitest';
import { buildDiscoveryBlueprint, canPublish } from './blueprint.js';
import { compileBlueprintToWorkflow } from './compile-workflow.js';
import { validateWorkflowIR } from '../../workflow/schema.js';
import type { CandidateProgram, DiscoverySessionState } from '../schema.js';

const session: DiscoverySessionState = {
  id: 'disc_compile',
  status: 'ready_to_publish',
  revision: 2,
  userGoal: '월간 매출 보고',
  exampleIds: ['ex_1'],
  sourceInventory: [],
  observations: [{
    id: 'obs_1',
    exampleId: 'ex_1',
    path: 'field.total',
    label: 'total',
    value: { kind: 'number', value: 100, display: '100' },
    role: 'dynamic_value',
    required: true,
  }],
  candidates: [{
    id: 'c1',
    observationPath: 'field.total',
    expr: { op: 'aggregate', input: { op: 'source', sourceId: 'rdb:sales' }, fn: 'sum', column: 'amount' },
    score: { total: 0.95, replay: 1, simplicity: 0.7 },
    replayResults: [{ exampleId: 'ex_1', expected: 100, actual: 100, match: 1, pass: true }],
    status: 'accepted',
  } as CandidateProgram],
  budgets: {
    sourceReadsUsed: 1,
    sourceReadsMax: 10,
    elapsedMs: 5,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('compile', () => {
  it('builds a publishable blueprint from accepted candidates', () => {
    const blueprint = buildDiscoveryBlueprint(session);
    expect(blueprint?.publishable).toBe(true);
    expect(blueprint?.fields).toHaveLength(1);
    expect(blueprint?.outputContract).toMatchObject({
      version: 1,
      fields: [{
        path: 'field.total',
        kind: 'number',
        baseline: { sampleCount: 1, numericMin: 100, numericMax: 100 },
      }],
    });
    expect(canPublish({ ...session, blueprint }).ok).toBe(true);
  });

  it('compiles blueprint to valid WorkflowIR with preserved mappings', () => {
    const blueprint = buildDiscoveryBlueprint(session)!;
    const ir = compileBlueprintToWorkflow(blueprint, { name: '월간 보고' });
    const validated = validateWorkflowIR(ir);
    expect(validated.ok).toBe(true);
    expect(ir.trigger).toEqual({ type: 'manual' });
    const evalSteps = ir.steps.filter((step) => step.type === 'action' && step.action === 'evaluate');
    expect(evalSteps.length).toBeGreaterThan(0);
    expect(evalSteps[0]?.params.expr).toBeTruthy();
    expect(ir.outputContract?.inputSchemas).toEqual([{
      sourceId: 'rdb:sales',
      stepId: expect.stringMatching(/^read_/),
      columns: [{ name: 'amount', type: 'number' }],
    }]);
    expect(JSON.parse(ir.document ?? '{}')).toMatchObject({
      origin: 'discovery',
      sessionId: session.id,
    });
    expect(evalSteps[0]?.bindings).toEqual({
      table: {
        from: expect.stringMatching(/^read_/),
        output: 'rows',
      },
    });
  });

  it('binds every source used by a multi-source transform expression', () => {
    const blueprint = buildDiscoveryBlueprint(session)!;
    const sourceMapping = blueprint.fields[0]?.mapping;
    if (!sourceMapping) throw new Error('missing source mapping');

    const multiSourceBlueprint = {
      ...blueprint,
      fields: [{
        ...blueprint.fields[0]!,
        mapping: {
          op: 'ratio' as const,
          numerator: sourceMapping,
          denominator: {
            op: 'aggregate' as const,
            input: { op: 'source' as const, sourceId: 'rdb:targets' },
            fn: 'sum' as const,
            column: 'amount',
          },
          multiplyBy: 100,
        },
      }],
    };

    const ir = compileBlueprintToWorkflow(multiSourceBlueprint);
    const evalStep = ir.steps.find(
      (step) => step.type === 'action' && step.action === 'evaluate',
    );
    if (!evalStep || evalStep.type !== 'action') throw new Error('missing evaluate step');

    const targetReadStep = ir.steps.find(
      (step) => step.type === 'action' && step.connector === 'rdb' && step.params.table === 'targets',
    );
    if (!targetReadStep || targetReadStep.type !== 'action') throw new Error('missing target read step');

    expect(evalStep.bindings).toMatchObject({
      table: { output: 'rows' },
      [`snapshot.rdb:targets`]: {
        from: targetReadStep.id,
        output: 'rows',
      },
    });
  });

  it('blocks publish when replay gate fails', () => {
    const gate = canPublish({ ...session, status: 'validating', candidates: [] });
    expect(gate.ok).toBe(false);
  });
});
