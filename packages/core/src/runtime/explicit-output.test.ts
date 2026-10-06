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

  it('preserves an upstream page boundary when materializing table rows', () => {
    const outputs = materializeStepOutputs('search', { messages: 'TableArtifact' }, {
      messages: [{ id: 'one' }], truncated: true, nextPageToken: 'next',
    });
    expect(outputs.messages).toMatchObject({ truncated: true, completeness: { status: 'partial', hasMore: true } });
    const complete = materializeStepOutputs('search', { messages: 'TableArtifact' }, {
      messages: [{ id: 'one' }], truncated: false,
    });
    expect(complete.messages).toMatchObject({ completeness: { status: 'complete' } });
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
    const notify = ir.steps[1];
    if (notify?.type !== 'action') throw new Error('expected a notify action');

    expect(
      applyStepBindings(notify, ir, notify.params, {}, {}, outputs).text,
    ).toBe('{"ok":true}');
    expect(
      resolveStepParams(
        { text: '{{fetch.response.body}}' },
        { executionId: 'exec-typed-output', variables: {}, outputs, log: () => {} },
        { fetch: { response: { body: 'stale' } } },
      ).text,
    ).toBe('{"ok":true}');
  });

  it('rejects objects interpolated into mixed text templates instead of sending [object Object]', () => {
    const ctx = { executionId: 'e', variables: {}, log: () => undefined };
    expect(() => resolveStepParams({ text: 'Result: {{fetch.data}}' }, ctx, { fetch: { data: { a: 1 } } }))
      .toThrow(expect.objectContaining({ code: 'template_non_primitive', reference: 'fetch.data' }));
    expect(resolveStepParams({ payload: '{{fetch.data}}' }, ctx, { fetch: { data: { a: 1 } } }))
      .toEqual({ payload: { a: 1 } });
  });

  it('leaves a declared port unresolved when the step result record lacks it', () => {
    expect(resolveBindingValue({ from: 'fetch', output: 'body' }, ir, { fetch: { status: 500 } }, {})).toBeUndefined();
  });

  it('resolves nested trigger template paths through trigger variables', () => {
    const ctx = { executionId: 'e', variables: { payload: { subject: 'Hi' } }, log: () => undefined };
    expect(resolveStepParams({ text: 'S: {{trigger.payload.subject}}' }, ctx, {})).toEqual({ text: 'S: Hi' });
  });
});
