import { describe, expect, it } from 'vitest';
import { applyStepBindings, inferWorkflowBindings } from '../../bindings.js';
import type { WorkflowIR } from '../../schema.js';
describe('structured HTTP response binding', () => {
  it('maps a structured HTTP text response to its body before forwarding it', () => {
    const ir: WorkflowIR = {
      id: 'wf-http-to-slack',
      name: 'HTTP 결과 전달',
      goal: 'HTTP 결과 전송',
      version: 1,
      trigger: { type: 'manual' },
      inputs: [],
      steps: [
        { type: 'action', id: 'fetch', connector: 'http', action: 'request', params: { method: 'GET', path: '/status' }, sideEffect: 'NONE' },
        { type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ax' }, sideEffect: 'EXTERNAL' },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };
    const inferred = inferWorkflowBindings(ir);
    const notify = inferred.steps.find((step) => step.id === 'notify');
    if (!notify || notify.type !== 'action') throw new Error('missing notify action');
    expect(applyStepBindings(notify, inferred, notify.params, { fetch: { status: 200, body: '{"ok":true}' } }, {}).text).toBe('{"ok":true}');
  });
});
