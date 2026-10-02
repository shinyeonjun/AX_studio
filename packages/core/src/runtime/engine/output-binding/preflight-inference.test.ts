import { describe, expect, it, vi } from 'vitest';
import { createAgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { validateWorkflowContracts } from '../../../workflow/contract-validator.js';
import { parseWorkflowIR, type Step, type WorkflowIR } from '../../../workflow/schema.js';
import { WorkflowRuntime } from '../../engine.js';
import { NoReadProvider } from '../fixtures.js';

function workflow(nested: boolean, invalidBinding = false): WorkflowIR {
  const control: Step[] = nested ? ['root', 'nested'].map((id, index) => ({
    type: 'if',
    id,
    condition: { op: 'eq', left: { lit: 1 }, right: { lit: 1 } },
    thenStepIds: index === 0 ? ['nested'] : ['brief', 'notify'],
  })) : [];
  return {
    name: 'synthetic inferred bindings',
    goal: 'preserve inference before full contract validation',
    version: 1,
    inputs: [],
    trigger: { type: 'manual' },
    steps: [
      { type: 'action', id: 'fetch', connector: 'http', action: 'request', params: { connectionId: 'test-http', path: '/synthetic' }, sideEffect: 'NONE' },
      ...control,
      {
        type: 'ai_decision',
        id: 'brief',
        goal: 'summarize synthetic input',
        investigation: false,
        maxReads: 1,
        inputContracts: { sourceText: 'TextArtifact' },
        ...(invalidBinding ? { bindings: { sourceText: { from: 'missing', output: 'body' } } } : {}),
        outputSchema: {
          type: 'object',
          properties: { conclusion: { type: 'string', purpose: 'prose' } },
          required: ['conclusion'],
        },
      },
      { type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: 'test-channel' }, sideEffect: 'EXTERNAL' },
    ],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
  };
}

function executionDependencies() {
  const provider = new NoReadProvider();
  const structured = vi.spyOn(provider, 'generateStructured');
  const text = vi.spyOn(provider, 'generateText');
  const http = vi.fn(async () => ({
    ok: true as const,
    data: { status: 200, statusText: 'OK', headers: {}, body: 'synthetic source', truncated: false, url: 'https://test.invalid/synthetic' },
  }));
  const slack = vi.fn(async () => ({ ok: true as const, data: {} }));
  return {
    structured, text, http, slack,
    config: {
      connectors: { http: { name: 'http', execute: http }, slack: { name: 'slack', execute: slack } },
      investigationRunner: createInvestigationRunner(createAgentHarness(provider)),
    },
  };
}

describe('runtime inferred contract preflight', () => {
  it.each([false, true])('executes an acyclic workflow requiring inferred bindings (nested: %s)', async (nested) => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const dependencies = executionDependencies();
      const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, ...dependencies.config });
      const ir = workflow(nested);
      expect(validateWorkflowContracts(ir)).toContainEqual(expect.objectContaining({
        code: 'missing_input_contract', stepId: 'brief',
      }));

      const result = await runtime.executeWorkflow(ir, { ephemeral: true });

      expect(result.status, JSON.stringify(result.log)).toBe('success');
      const snapshot = parseWorkflowIR(JSON.parse(store.getExecution(result.executionId)?.irJson ?? 'null'));
      expect(snapshot.steps.find((step) => step.id === 'brief')).toMatchObject({
        bindings: { sourceText: { from: 'fetch', output: 'body' } },
      });
      expect(snapshot.steps.find((step) => step.id === 'notify')).toMatchObject({
        bindings: { text: { from: 'brief', output: 'conclusion' } },
      });
      expect(dependencies.http).toHaveBeenCalledOnce();
      expect(dependencies.structured).toHaveBeenCalledOnce();
      expect(dependencies.slack).toHaveBeenCalledExactlyOnceWith(
        'message.send', { channel: 'test-channel', text: '주간 보고 결과' }, expect.anything(),
      );
    } finally {
      db.close?.();
    }
  });

  it('still rejects invalid contracts after inference without provider or connector calls', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      const store = new WorkflowStore(db);
      const dependencies = executionDependencies();
      const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, ...dependencies.config });

      const result = await runtime.executeWorkflow(workflow(true, true), { ephemeral: true });

      expect(result).toMatchObject({ status: 'failed', errorCode: 'contract_validation_failed' });
      expect(result.log).toContainEqual(expect.objectContaining({
        data: { issues: expect.arrayContaining([expect.objectContaining({
          code: 'missing_input_contract', stepId: 'brief',
        })]) },
      }));
      expect(dependencies.structured).not.toHaveBeenCalled();
      expect(dependencies.text).not.toHaveBeenCalled();
      expect(dependencies.http).not.toHaveBeenCalled();
      expect(dependencies.slack).not.toHaveBeenCalled();
    } finally {
      db.close?.();
    }
  });
});
