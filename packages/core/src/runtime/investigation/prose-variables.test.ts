import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorContext } from '../../connectors/types.js';
import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import { PROSE_OUTPUT_SCHEMA } from '../../workflow/ai-output-contract.js';
import { executeStep, resolveActionParamsForExecution } from '../step-executor.js';
import { isExecutionCheckpoint } from '../control-flow.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../catalog/dynamic-catalog.js';
import { assertWorkflowOutputBoundaries } from '../../workflow/contract-validation/structure/references-validation.js';

afterEach(clearDynamicCatalogForTests);

describe('presentation provenance through action variables', () => {
  it('blocks a content action from laundering text through a trigger-variable alias', async () => {
    registerDynamicCapabilities([{ id: 'fixture.write', connector: 'fixture', kind: 'write', label: 'Write prose', description: 'Synthetic content sink',
      sideEffect: 'REVERSIBLE', params: [{ name: 'text', label: 'Text', question: 'Text', required: true, purpose: 'prose' }],
      io: { inputs: { text: 'TextArtifact' }, outputs: { text: 'TextArtifact' } } }]);
    const draft: Extract<Step, { type: 'ai_decision' }> = { type: 'ai_decision', id: 'draft', goal: '본문', investigation: false, outputSchema: PROSE_OUTPUT_SCHEMA };
    const write: Extract<Step, { type: 'action' }> = { type: 'action', id: 'write', connector: 'fixture', action: 'write',
      params: {}, bindings: { text: { from: 'draft', output: 'conclusion' } }, sideEffect: 'REVERSIBLE' };
    const search: Extract<Step, { type: 'action' }> = { type: 'action', id: 'search', connector: 'slack', action: 'messages.search',
      params: { query: '{{trigger.summary}}' }, sideEffect: 'NONE' };
    const ir: WorkflowIR = { name: 'Synthetic variables', goal: 'No model filters', version: 1, steps: [draft, write, search],
      inputs: [], permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
    const ctx: ConnectorContext = { executionId: 'fixture', variables: {}, log: vi.fn() };
    const results = { draft: { conclusion: 'model-selected-filter' } };
    const execute = vi.fn(async (_action, params, context) => {
      context.variables.summary = params.text;
      return { ok: true, data: { text: params.text } };
    });

    await executeStep(write, ir, ctx, results, {} as WorkflowStore,
      { fixture: { name: 'fixture', execute } }, undefined, vi.fn());

    expect(execute).toHaveBeenCalledOnce();
    expect(ctx.presentationVariableSources).toEqual({ summary: 'write' });
    expect(() => resolveActionParamsForExecution(search, ir, ctx, results))
      .toThrow(expect.objectContaining({ code: 'ai_output_boundary' }));
    const checkpoint = { variables: { ...ctx.variables }, stepResults: results,
      presentationVariableSources: ctx.presentationVariableSources, remainingStepIds: ['search'] };
    expect(isExecutionCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).toBe(true);
    expect(() => assertWorkflowOutputBoundaries(ir, JSON.parse(JSON.stringify(checkpoint)).presentationVariableSources))
      .toThrow(expect.objectContaining({ code: 'ai_output_boundary' }));
  });
});
