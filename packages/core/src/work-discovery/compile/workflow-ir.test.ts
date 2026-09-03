import { describe, expect, it } from 'vitest';
import { buildDiscoveryBlueprint } from './blueprint.js';
import { compileBlueprintToWorkflow } from './compile-workflow.js';
import { session } from './fixtures.js';
import { validateWorkflowIR } from '../../workflow/schema.js';
describe('compile WorkflowIR', () => {
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
    expect(JSON.parse(ir.document ?? '{}')).toMatchObject({ origin: 'discovery', sessionId: session.id });
    expect(evalSteps[0]?.bindings).toEqual({ table: { from: expect.stringMatching(/^read_/), output: 'rows' } });
  });
});
