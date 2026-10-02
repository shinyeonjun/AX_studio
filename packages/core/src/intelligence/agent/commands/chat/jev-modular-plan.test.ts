import { afterEach, describe, expect, it } from 'vitest';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../../catalog/dynamic-catalog.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import type { DecisionAnswer, DecisionEvaluationRequest } from '../../../../contracts/decision.js';
import { planJevSelectedTools } from './jev-workflow-plan.js';
import { validateJevPlan } from './jev-plan-contract.js';
import { AxUiPresentationSchema } from '../schema.js';

const choice = (choice: string): DecisionAnswer => ({ type: 'choice', choice, probabilities: { [choice]: 1 } });
const source: ConnectorCapability = { id: 'lab.source', connector: 'lab', kind: 'write', label: 'Source', description: 'Synthetic source', params: [], io: { inputs: {}, outputs: { body: 'TextArtifact' } } };
const target: ConnectorCapability = { id: 'lab.target', connector: 'lab', kind: 'write', label: 'Target', description: 'Synthetic target', params: [
  { name: 'body', label: 'Body', question: 'Body?', required: true },
  { name: 'title', label: 'Title', question: 'Title?', required: false },
], io: { inputs: { body: 'TextArtifact' }, outputs: {} } };
afterEach(clearDynamicCatalogForTests);
const review = { requirements: choice('met'), scope: choice('preserved') };
function plan(caps: ConnectorCapability[], evaluate: (r: DecisionEvaluationRequest) => Promise<{ answers: Record<string, DecisionAnswer>; providerRequestCount?: number; requestBytes?: number }>, extra: Partial<Parameters<typeof planJevSelectedTools>[0]> = {}) {
  registerDynamicCapabilities(caps);
  return planJevSelectedTools({ decisionEngine: { evaluate }, request: '도구에 "합성 문구"를 넣어줘', mode: 'one_shot', connectedConnectors: ['lab'], readOperationHints: [], actionHints: caps.map((capability, index) => ({ key: `tool_${index}`, capability })), ...extra });
}
describe('bounded modular Jev planner', () => {
  it('resolves binding choices in a phase after argument choices', async () => {
    const phases: string[][] = [];
    const result = await plan([source, { ...source, id: 'lab.source2' }, target], async (r): Promise<{ answers: Record<string, DecisionAnswer>; providerRequestCount?: number; requestBytes?: number }> => {
      phases.push(Object.keys(r.questions));
      if (r.questions.requirements) return { answers: review };
      return { answers: Object.fromEntries(Object.keys(r.questions).map(id => [id, choice(id.startsWith('action_input') ? 'field_1' : 'source_0')])) };
    });
    expect(phases).toEqual([['action_input_2'], ['binding_2_0'], ['requirements','scope']]);
    expect(result.kind).toBe('command');
  });
  it('repairs cyclic bindings within their original candidates without changing arguments', async () => {
    let round = 0;
    const linked = { ...target, params: [], io: { inputs: { body: 'TextArtifact' as const }, outputs: { body: 'TextArtifact' as const } } };
    const result = await plan([source, { ...linked, id: 'lab.b' }, { ...linked, id: 'lab.c' }], async (r): Promise<{ answers: Record<string, DecisionAnswer>; providerRequestCount?: number; requestBytes?: number }> => {
      if (r.questions.requirements) return { answers: review };
      round++;
      return { answers: Object.fromEntries(Object.keys(r.questions).map(id => [id, choice(round === 1 ? 'source_1' : 'source_0')])) };
    }, { request: '합성 도구를 연결해줘' });
    expect(round).toBe(2); expect(result.kind).toBe('command');
    if(result.kind === 'command') expect(result.commandPlan?.commands.slice(1).map(c => c.dependsOn)).toEqual([['action_1'],['action_1']]);
  });
  it.each([[undefined,6],[100,8]] as const)('enforces phase cap %s', async (limit, expected) => {
    const result = await plan(Array.from({ length: 9 }, (_, i) => ({ ...target, id: `lab.target${i}` })), async r => ({ answers: { [Object.keys(r.questions)[0]!]: choice('field_0') } }), { maxEvaluatorPhases: limit });
    expect(result.kind).toBe('clarify'); expect(result.telemetry.calls).toBe(expected);
  });
  it('batches independent fields, then omits bindings for accepted concrete parameters', async () => {
    const requests: DecisionEvaluationRequest[] = [];
    const result = await plan([source, target, { ...target, id: 'lab.target2' }], async (r): Promise<{ answers: Record<string, DecisionAnswer>; providerRequestCount?: number; requestBytes?: number }> => {
      requests.push(r);
      return { answers: r.questions.requirements ? review : Object.fromEntries(Object.keys(r.questions).map(id => [id, choice('field_0')])), providerRequestCount: 2, requestBytes: 100 };
    });
    expect(Object.keys(requests[0]!.questions)).toEqual(['action_input_1', 'action_input_2']);
    expect(result.kind).toBe('command');
    expect(result.telemetry).toMatchObject({ calls: 2, providerRequestCount: 4, estimatedRequestBytes: 200 });
    expect(AxUiPresentationSchema.safeParse(result.presentation).success).toBe(true);
    expect(result.presentation).toMatchObject({ inputs: [], actions: [] });
  });
  it('repairs only a missing answer and retains accepted answers', async () => {
    const seen: string[][] = [];
    const result = await plan([target, { ...target, id: 'lab.target2' }], async (r): Promise<{ answers: Record<string, DecisionAnswer>; providerRequestCount?: number; requestBytes?: number }> => {
      seen.push(Object.keys(r.questions));
      if (r.questions.requirements) return { answers: review };
      if (seen.length === 1) return { answers: { action_input_0: choice('field_0') } };
      return { answers: { action_input_1: choice('field_0'), action_input_0: choice('field_1') } };
    });
    expect(seen[1]).toEqual(['action_input_1']);
    expect(result.kind).toBe('command');
    if (result.kind === 'command') expect(result.commandPlan?.commands[0]?.input.body).toBe('합성 문구');
  });
  it.each(['missing', 'unclear'])('stops on requirement %s', async verdict => {
    const result = await plan([source], async () => ({ answers: { ...review, requirements: choice(verdict) } }), { request: 'source 실행' });
    expect(result.kind).toBe('clarify'); expect(result.telemetry.calls).toBe(1);
  });
  it.each(['expanded', 'unclear'])('stops on scope %s', async verdict => {
    expect((await plan([source], async () => ({ answers: { ...review, scope: choice(verdict) } }), { request: 'source 실행' })).kind).toBe('clarify');
  });
  it.each([NaN, Infinity, -1, 0])('rejects invalid phase limit %s without evaluation', async maxEvaluatorPhases => {
    let calls = 0; const result = await plan([source], async () => { calls++; return { answers: review }; }, { maxEvaluatorPhases });
    expect(result.kind).toBe('clarify'); expect(calls).toBe(0);
  });
  it('stops when repair makes no progress', async () => {
    const result = await plan([target], async () => ({ answers: {} }));
    expect(result.kind).toBe('clarify'); expect(result.telemetry.calls).toBe(2);
  });
  it('excludes supplied host values from review and UI', async () => {
    const states: unknown[] = [];
    const result = await plan([target], async (r): Promise<{ answers: Record<string, DecisionAnswer>; providerRequestCount?: number; requestBytes?: number }> => { states.push(r); return { answers: review }; }, { request: '전달해줘', actionInputValues: [{ label: 'Body', value: 'PRIVATE_SENTINEL', capabilityId: target.id, parameterName: 'body' }] });
    expect(result.kind).toBe('command');
    expect(JSON.stringify([states, result.presentation])).not.toContain('PRIVATE_SENTINEL');
  });
  it('records completed usage before propagating cancellation', async () => {
    const controller = new AbortController();
    await expect(plan([source], async () => { controller.abort(); return { answers: review }; }, { signal: controller.signal })).rejects.toThrow();
  });
});
describe('host plan contracts', () => {
  const step = (id: string, capability = source) => ({ id, capability, params: {}, bindings: {} });
  it('orders a forward reference', () => {
    const result = validateJevPlan([{ ...step('b', target), bindings: { body: { from: 'a', output: 'body' } } }, step('a')], []);
    expect(result.ok).toBe(true); expect(result.ordered.map(s => s.id)).toEqual(['a', 'b']);
  });
  it.each(['unknown', 'self', 'wrong_type', 'cycle', 'duplicate'])('rejects %s', kind => {
    const a = step('a', { ...target, io: { inputs: { body: 'TextArtifact' }, outputs: { body: kind === 'wrong_type' ? 'TableArtifact' : 'TextArtifact' } } });
    const b = step(kind === 'duplicate' ? 'a' : 'b', target);
    const result = validateJevPlan([{ ...a, bindings: kind === 'cycle' ? { body: { from: 'b', output: 'body' } } : {} },
      { ...b, bindings: { body: { from: kind === 'unknown' ? 'missing' : kind === 'self' ? 'b' : 'a', output: 'body' } } }], []);
    expect(result.ok).toBe(false);
  });
  it('distinguishes pending host text fields from missing artifact ports', () => {
    expect(validateJevPlan([step('a', target)], []).pendingInputs).toEqual([{ stepId: 'a', parameter: 'body' }]);
    expect(validateJevPlan([step('a', { ...target, io: { inputs: { table: 'TableArtifact' }, outputs: {} } })], []).errors).toContain('missing_input');
  });
  it('does not accept text as a table input or a deferred unknown ref as a literal', () => {
    const tableTarget = { ...target, io: { inputs: { table: 'TableArtifact' as const }, outputs: {} } };
    expect(validateJevPlan([{ ...step('a', tableTarget), params: { table: 'not a table' } }], []).errors).toContain('literal_type_mismatch');
    expect(validateJevPlan([{ ...step('a', target), params: { body: { ref: 'missing.body' } } }], []).errors).toContain('unvalidated_parameter_reference');
  });
});
