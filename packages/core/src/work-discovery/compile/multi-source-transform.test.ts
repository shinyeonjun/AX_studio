import { describe, expect, it } from 'vitest';
import { buildDiscoveryBlueprint } from './blueprint.js';
import { compileBlueprintToWorkflow } from './compile-workflow.js';
import { session } from './fixtures.js';
describe('compile multi-source transform', () => {
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
          denominator: { op: 'aggregate' as const, input: { op: 'source' as const, sourceId: 'rdb:targets' }, fn: 'sum' as const, column: 'amount' },
          multiplyBy: 100,
        },
      }],
    };
    const ir = compileBlueprintToWorkflow(multiSourceBlueprint);
    const evalStep = ir.steps.find((step) => step.type === 'action' && step.action === 'evaluate');
    if (!evalStep || evalStep.type !== 'action') throw new Error('missing evaluate step');
    const targetReadStep = ir.steps.find((step) => step.type === 'action' && step.connector === 'rdb' && step.params.table === 'targets');
    if (!targetReadStep || targetReadStep.type !== 'action') throw new Error('missing target read step');
    expect(evalStep.bindings).toMatchObject({
      table: { output: 'rows' },
      [`snapshot.rdb:targets`]: { from: targetReadStep.id, output: 'rows' },
    });
  });
});
