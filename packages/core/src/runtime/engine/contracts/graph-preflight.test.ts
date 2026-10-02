import { describe, expect, it, vi } from 'vitest';
import { createAgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { validateWorkflowContracts } from '../../../workflow/contract-validator.js';
import { parseWorkflowIR } from '../../../workflow/schema.js';
import type { Step, WorkflowIR } from '../../../workflow/schema.js';
import { WorkflowRuntime } from '../../engine.js';
import { NoReadProvider } from '../fixtures.js';

function branch(id: string, thenStepIds: string[]): Step {
  return {
    type: 'if',
    id,
    condition: { op: 'eq', left: { lit: 1 }, right: { lit: 1 } },
    thenStepIds,
  };
}

function workflow(steps: Step[]): WorkflowIR {
  return {
    name: 'cycle',
    goal: 'cycle',
    version: 1,
    inputs: [],
    steps,
    permissions: {},
    approval: [],
    allowExternalAuto: false,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
  };
}

describe('runtime structural preflight', () => {
  it('preserves the cycle through schema parsing and the existing validator detects it', () => {
    const ir = workflow([branch('root', ['a']), branch('a', ['b']), branch('b', ['a'])]);
    const parsed = parseWorkflowIR(ir);
    expect(parsed.steps).toEqual(ir.steps);
    expect(validateWorkflowContracts(parsed)).toContainEqual(expect.objectContaining({
      code: 'invalid_control_flow',
      stepId: 'a',
      message: expect.stringContaining('if 분기 순환'),
    }));
  });

  it('records a rooted indirect cycle as a contract failure before binding inference', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const runtime = new WorkflowRuntime({
        store,
        globalActive: true,
        workflowActive: {},
        connectors: {},
      });

      await expect(runtime.executeWorkflow(workflow([
        branch('root', ['a']),
        branch('a', ['b']),
        branch('b', ['a']),
      ]), { ephemeral: true })).resolves.toMatchObject({
        status: 'failed',
        errorCode: 'contract_validation_failed',
      });
    } finally {
      db.close?.();
    }
  }, 2_000);

  it.each([
    { name: 'rooted indirect cycle', steps: [branch('root', ['a']), branch('a', ['b']), branch('b', ['a'])], message: 'if 분기 순환' },
    { name: 'rootless indirect cycle', steps: [branch('a', ['b']), branch('b', ['a'])], message: 'if 분기 순환' },
    { name: 'indirect else cycle', steps: [branch('root', ['a']), { ...branch('a', ['notify']), elseStepIds: ['b'] }, { ...branch('b', ['notify']), elseStepIds: ['a'] }], message: 'if 분기 순환' },
    { name: 'then self edge', steps: [branch('a', ['a'])], message: '자기 자신' },
    { name: 'else self edge', steps: [{ ...branch('a', ['notify']), elseStepIds: ['a'] }], message: '자기 자신' },
    { name: 'duplicate IDs', steps: [branch('a', ['notify']), branch('a', ['notify'])], message: 'id가 중복' },
    { name: 'dangling then edge', steps: [branch('root', ['missing'])], message: '존재하지 않는' },
    { name: 'dangling else edge', steps: [{ ...branch('root', ['notify']), elseStepIds: ['missing'] }], message: '존재하지 않는' },
  ])('rejects $name before any provider or connector call', async ({ steps, message }) => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const provider = new NoReadProvider();
      const structured = vi.spyOn(provider, 'generateStructured');
      const text = vi.spyOn(provider, 'generateText');
      const execute = vi.fn(async () => ({ ok: true as const, data: {} }));
      const started = vi.fn();
      const finished = vi.fn();
      const runtime = new WorkflowRuntime({
        store,
        globalActive: true,
        workflowActive: {},
        connectors: { slack: { name: 'slack', execute } },
        investigationRunner: createInvestigationRunner(createAgentHarness(provider)),
        onExecutionStarted: started,
        onExecutionFinished: finished,
      });
      const ir = {
        ...workflow([
          { type: 'ai_decision', id: 'brief', goal: 'synthetic brief', investigation: false, maxReads: 1 },
          { type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: 'test-channel' }, sideEffect: 'EXTERNAL' },
          ...steps,
        ]),
        allowExternalAuto: true,
      };

      const result = await runtime.executeWorkflow(ir, { ephemeral: true });

      expect(result).toMatchObject({ status: 'failed', errorCode: 'contract_validation_failed' });
      expect(result.log).toContainEqual(expect.objectContaining({
        code: 'contract_validation_failed',
        data: { issues: expect.arrayContaining([expect.objectContaining({
          code: 'invalid_control_flow', message: expect.stringContaining(message),
        })]) },
      }));
      expect(store.getExecution(result.executionId)).toMatchObject({ status: 'failed', errorCode: 'contract_validation_failed', ephemeral: true });
      expect(started).toHaveBeenCalledExactlyOnceWith(result.executionId);
      expect(finished).toHaveBeenCalledExactlyOnceWith(result);
      expect(structured).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      db.close?.();
    }
  }, 2_000);
});
