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
  observations: [],
  candidates: [{
    id: 'c1',
    observationPath: 'field.total',
    expr: { op: 'aggregate', input: { op: 'source', sourceId: 'rdb:sales' }, fn: 'sum', column: 'amount' },
    score: { total: 0.95, replay: 1, semantic: 1, simplicity: 0.7 },
    replayResults: [{ exampleId: 'ex_1', expected: 100, actual: 100, match: 1, pass: true }],
    status: 'accepted',
  } as CandidateProgram],
  budgets: {
    sourceReadsUsed: 1,
    sourceReadsMax: 10,
    modelCallsUsed: 0,
    modelCallsMax: 4,
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
    expect(canPublish({ ...session, blueprint }).ok).toBe(true);
  });

  it('compiles blueprint to valid WorkflowIR', () => {
    const blueprint = buildDiscoveryBlueprint(session)!;
    const ir = compileBlueprintToWorkflow(blueprint, { name: '월간 보고' });
    const validated = validateWorkflowIR(ir);
    expect(validated.ok).toBe(true);
    expect(ir.trigger).toEqual({ type: 'manual' });
    expect(JSON.parse(ir.document ?? '{}')).toMatchObject({ origin: 'discovery' });
  });

  it('blocks publish when replay gate fails', () => {
    const gate = canPublish({ ...session, status: 'validating', candidates: [] });
    expect(gate.ok).toBe(false);
  });
});
