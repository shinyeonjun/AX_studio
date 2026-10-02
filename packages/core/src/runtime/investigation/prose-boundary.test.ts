import { describe, expect, it, vi } from 'vitest';
import type { DecisionEngine } from '../../contracts/decision.js';
import type { ConnectorContext } from '../../connectors/types.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import { PROSE_OUTPUT_SCHEMA } from '../../workflow/ai-output-contract.js';
import { runAiDecisionLoop, type DecisionModelRun } from './decision-loop.js';
import { runAiDecision } from './run-decision.js';
import { resolveActionParamsForExecution } from '../step-executor.js';
import { planDecisionOutputs } from './decision-outputs.js';

const draft: Extract<Step, { type: 'ai_decision' }> = {
  type: 'ai_decision', id: 'draft', goal: '표 근거를 한국어 본문으로 요약한다',
  investigation: false, outputSchema: PROSE_OUTPUT_SCHEMA,
};

function workflow(steps: Step[]): WorkflowIR {
  return { name: 'Prose boundary', goal: 'Content only', version: 1, steps,
    inputs: [], permissions: {}, approval: [], allowExternalAuto: false,
    assumptions: [], sideEffects: {}, dataPolicy: {} };
}

async function run(step = draft, runModel: DecisionModelRun = vi.fn(async () => ({})), decisionEngine?: DecisionEngine) {
  const stepResults: Record<string, unknown> = {};
  const ctx: ConnectorContext = { executionId: 'synthetic', variables: {}, log: vi.fn() };
  await runAiDecisionLoop({ step, ir: workflow([step]), ctx, stepResults, connectors: {},
    allowReads: false, cloudAllowed: true, evidence: [], documentRequired: false,
    outputDecisionEngine: decisionEngine, decisionInput: 'fixture evidence', runModel });
  return { stepResults, ctx };
}

describe('LLM prose boundary in runtime', () => {
  it('discards extra model controls and preserves the Jev decision', async () => {
    const step = { ...draft, outputSchema: {
      type: 'object', properties: { conclusion: { type: 'string', purpose: 'prose' }, notify: { type: 'boolean' } },
      required: ['conclusion', 'notify'],
    } };
    const model = vi.fn(async () => ({ conclusion: '검토한 본문', notify: true,
      destination: 'guessed-target', filter: 'drop rows', approved: true, nextRead: 'gmail.message.send',
      category: 'ready', confidence: 1, needMore: true }));
    const decisionEngine: DecisionEngine = { evaluate: vi.fn(async () => ({ answers: {
      output_0: { type: 'choice' as const, choice: 'false', probabilities: { true: 0.1, false: 0.9 } },
    } })) };

    const { stepResults } = await run(step, model, decisionEngine);

    expect(model).toHaveBeenCalledWith(expect.objectContaining({ outputFields: ['conclusion'], decisionValues: { notify: false } }));
    expect(stepResults.draft).toEqual({ conclusion: '검토한 본문', notify: false, needMore: false });
  });

  it('retains only the legacy conclusion when the step has no outputSchema', async () => {
    const legacy = { ...draft, outputSchema: undefined };
    expect(planDecisionOutputs(legacy).modelFields).toEqual(['conclusion']);
    const { stepResults } = await run(legacy, async () => ({ conclusion: '요약', arbitrary: 'control', approved: true }));
    expect(stepResults.draft).toEqual({ conclusion: '요약', needMore: false });
  });

  it.each([
    { type: 'string' }, { type: 'number' }, { type: 'array' }, { type: 'object' },
    { type: 'boolean', purpose: 'prose' }, { type: 'string', purpose: 'prose', enum: ['a', 'b'] },
  ])('rejects ambiguous or contradictory output contracts before any provider call: %j', async (definition) => {
    const model = vi.fn(async () => ({ unsafe: 'x' }));
    const decisionEngine: DecisionEngine = { evaluate: vi.fn(async () => ({ answers: {} })) };
    await expect(run({ ...draft, outputSchema: { properties: { unsafe: definition }, required: ['unsafe'] } }, model, decisionEngine))
      .rejects.toMatchObject({ code: 'ai_output_contract_invalid' });
    expect(model).not.toHaveBeenCalled();
    expect(decisionEngine.evaluate).not.toHaveBeenCalled();
  });

  it('rejects a provider that returns an object for a declared prose field', async () => {
    await expect(run(draft, (async () => ({ conclusion: { to: 'guessed-target' } })) as unknown as DecisionModelRun))
      .rejects.toMatchObject({ code: 'ai_output_invalid' });
  });

  it('does not reinterpret template syntax in bound prose', () => {
    const send: Extract<Step, { type: 'action' }> = {
      type: 'action', id: 'send', connector: 'gmail', action: 'message.send',
      params: { to: 'fixture@example.invalid', subject: '요약' },
      bindings: { body: { from: 'draft', output: 'conclusion' } }, sideEffect: 'EXTERNAL_HIGH',
    };
    const params = resolveActionParamsForExecution(send, workflow([draft, send]),
      { executionId: 'fixture', variables: { secret: 'MUST-NOT-BE-INTERPOLATED' }, log: vi.fn() },
      { draft: { conclusion: '원문 {{trigger.secret}} / {{draft.approved}}' } }).params;
    expect(params.body).toBe('원문 {{trigger.secret}} / {{draft.approved}}');
    expect(params.to).toBe('fixture@example.invalid');
  });

  it('blocks a persisted destination binding at the execution boundary', () => {
    const send: Extract<Step, { type: 'action' }> = {
      type: 'action', id: 'send', connector: 'slack', action: 'message.send',
      params: { text: 'literal' }, bindings: { channel: { from: 'draft', output: 'conclusion' } }, sideEffect: 'EXTERNAL',
    };
    expect(() => resolveActionParamsForExecution(send, workflow([draft, send]),
      { executionId: 'fixture', variables: {}, log: vi.fn() }, { draft: { conclusion: '#guessed' } }))
      .toThrow(expect.objectContaining({ code: 'ai_output_boundary' }));
  });

  it('does not send an earlier model summary to Jev as implicit evidence', async () => {
    const step: Extract<Step, { type: 'ai_decision' }> = {
      type: 'ai_decision', id: 'classify', goal: 'Classify original evidence', investigation: false,
      outputSchema: { properties: { notify: { type: 'boolean' } }, required: ['notify'] },
    };
    const decisionEngine: DecisionEngine = { evaluate: vi.fn(async (request) => {
      expect(JSON.stringify(request.state)).not.toContain('MODEL-PROSE-MUST-NOT-DRIVE-DECISIONS');
      expect(JSON.stringify(request.state)).toContain('ORIGINAL-EVIDENCE');
      return { answers: { output_0: { type: 'choice' as const, choice: 'false', probabilities: { false: 1 } } } };
    }) };
    await runAiDecision(step, workflow([draft, step]),
      { executionId: 'fixture', variables: {}, log: vi.fn() },
      { draft: { summary: 'MODEL-PROSE-MUST-NOT-DRIVE-DECISIONS' }, read: { text: 'ORIGINAL-EVIDENCE' } },
      undefined, {}, decisionEngine);
    expect(decisionEngine.evaluate).toHaveBeenCalledTimes(1);
  });
});
