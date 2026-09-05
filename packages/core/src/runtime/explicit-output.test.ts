import { describe, expect, it } from 'vitest';
import { buildHttpResponseArtifact } from '../contracts/artifacts/http-response.js';
import { buildTableArtifact } from '../contracts/artifacts/table-build.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { applyStepBindings, resolveBindingValue } from '../workflow/bindings.js';
import { materializeStepOutputs } from './output-ports.js';
import { resolveStepParams } from './param-resolution.js';

const ir: WorkflowIR = {
  id: 'wf-typed-outputs',
  name: 'typed outputs',
  goal: 'typed output test',
  version: 1,
  trigger: { type: 'manual' },
  inputs: [],
  steps: [
    { type: 'action', id: 'fetch', connector: 'http', action: 'request', params: { path: '/orders' }, sideEffect: 'NONE' },
    { type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ax' }, sideEffect: 'EXTERNAL', bindings: { text: { from: 'fetch', output: 'body' } } },
  ],
  permissions: {},
  approval: [],
  allowExternalAuto: true,
  assumptions: [],
  sideEffects: {},
  dataPolicy: {},
};

describe('runtime output seam', () => {
  it('materializes raw connector rows into a declared table output', () => {
    const outputs = materializeStepOutputs(
      'read-orders',
      { rows: 'TableArtifact' },
      [{ id: 'order-1', amount: 125000 }],
    );

    expect(outputs.rows).toMatchObject({
      kind: 'table',
      completeness: { status: 'complete', observedCount: 1, hasMore: false },
    });
  });

  it('prefers typed ports over stale legacy step results', () => {
    const table = buildTableArtifact({
      id: 'orders-typed',
      headers: ['id'],
      matrix: [['order-1']],
    });
    const value = resolveBindingValue(
      { from: 'fetch', output: 'rows' },
      ir,
      { fetch: [{ id: 'stale-order' }] },
      {},
      { fetch: { rows: table } },
    );

    expect(value).toEqual(table);
  });

  it('maps a TextArtifact body to a text input and resolves nested ports', () => {
    const response = buildHttpResponseArtifact({
      executionId: 'exec-typed-output',
      url: 'http://test.local/orders',
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{"ok":true}',
      truncated: false,
    });
    const outputs = { fetch: { response, body: { text: response.body, format: 'plain' } } };
    const notify = ir.steps[1]!;

    expect(
      applyStepBindings(notify as Extract<WorkflowIR['steps'][number], { type: 'action' }>, ir, notify.params, {}, {}, outputs).text,
    ).toBe('{"ok":true}');
    expect(
      resolveStepParams(
        { text: '{{fetch.response.body}}' },
        { variables: {}, outputs, log: () => {} },
        { fetch: { response: { body: 'stale' } } },
      ).text,
    ).toBe('{"ok":true}');
  });
});
