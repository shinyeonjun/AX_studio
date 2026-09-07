import { describe, expect, it, vi } from 'vitest';
import { buildDesignToolContext } from '../context.js';
import { executeDesignTool } from '../execute.js';
import { boundCapabilityEvidence, invokeReadCapability } from '../capability-invoke.js';
import type { ConnectorContext } from '../../../connectors/types.js';

function fixture(data: unknown, connector = 'rdb', allowUntrustedData = true) {
  const execute = vi.fn(async (_action: string, _params: Record<string, unknown>, _ctx: ConnectorContext) => ({ ok: true, data }));
  const ctx = buildDesignToolContext([], [connector], {
    allowUntrustedData,
    connectors: { [connector]: { name: connector, execute } },
  });
  return { ctx, execute };
}

describe('generic capability model evidence', () => {
  it('bounds table evidence without changing the connector result or execution parameters', async () => {
    const data = {
      kind: 'table', id: 'table-1', columns: [{ name: 'value', type: 'string' }],
      rows: Array.from({ length: 1_000 }, (_, index) => ({ index, values: { value: 'x'.repeat(200) } })),
      truncated: false, completeness: { status: 'complete', observedCount: 1_000, hasMore: false },
    };
    const { ctx, execute } = fixture(data);
    const params = { table: 'orders', limit: 1_000 };
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'rdb.query.read', params } }, ctx);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    expect(result.data).toMatchObject({ evidence: { truncated: true, reason: 'model_evidence_limit' } });
    expect(result.data).toMatchObject({ data: { truncated: true, completeness: { status: 'partial' } } });
    expect(data.rows).toHaveLength(1_000);
    expect(data.completeness.status).toBe('complete');
    expect(data.truncated).toBe(false);
    expect(execute.mock.calls[0]?.[1]).toEqual(params);
    expect((await invokeReadCapability(ctx, 'rdb.query.read', params)).data).toBe(data);
  });

  it.each([
    ['large HTTP body', 'http', 'http.request', { status: 200, body: 'x'.repeat(100_000) }],
    ['wide record', 'rdb', 'rdb.schema.describe', Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`field${i}`, 'x'.repeat(100)]))],
    ['escaped text', 'http', 'http.request', { body: '\u0000'.repeat(50_000) }],
    ['search hits and citations', 'slack', 'slack.messages.search', {
      hits: Array.from({ length: 1_000 }, (_, i) => ({ ref: { connector: 'slack', kind: 'message', id: String(i) }, score: 1, snippet: 'x'.repeat(1_000) })),
    }],
  ])('bounds %s with explicit partial evidence', async (_name, connector, id, data) => {
    const { ctx } = fixture(data, connector);
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id } }, ctx);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    expect(result.data).toMatchObject({ evidence: { truncated: true } });
  });

  it.each([
    ['rdb', 'rdb.query.read', { rows: [{ secret: 'private-row' }], profile: { min: 'private-row' } }],
    ['http', 'http.request', { status: 200, body: 'private-body', headers: { authorization: 'private-header' } }],
    ['local_sheet', 'local_sheet.read', { rows: [['private-cell']] }],
  ])('denies raw %s content before connector execution when untrusted data is disallowed', async (connector, id, data) => {
    const { ctx, execute } = fixture(data, connector, false);
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id } }, ctx);
    expect(result).toMatchObject({ ok: false, error: 'source_content_requires_local_ai' });
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it('allows only bounded search fields, never extra raw content or citation paths', async () => {
    const { ctx } = fixture({
      body: 'private-top-level',
      hits: [{
        ref: { connector: 'slack', kind: 'message', id: '1', path: 'private-path', raw: 'private-ref' },
        score: 1, snippet: 'safe snippet', body: 'private-hit',
      }],
    }, 'slack', false);
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'slack.messages.search' } }, ctx);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('safe snippet');
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it('preserves small evidence exactly and does not promote a partial upstream source to complete', async () => {
    const data = { kind: 'table', rows: [{ value: 7 }], truncated: true, completeness: { status: 'partial', reason: 'row_limit', hasMore: true } };
    const { ctx } = fixture(data);
    const result = await executeDesignTool({ tool: 'capabilities.invoke', args: { id: 'rdb.query.read' } }, ctx);
    expect(result.data).toMatchObject({ data, evidence: { truncated: false } });
  });

  it('bounds deeply nested, cyclic and non-JSON values without mutating source objects', () => {
    const cycle: Record<string, unknown> = { value: 1 };
    cycle.self = cycle;
    const deep = Array.from({ length: 100 }).reduce<unknown>((value) => ({ nested: value }), 'value');
    const data = { cycle, deep, bytes: Buffer.alloc(100_000), bigint: 10n };
    const result = boundCapabilityEvidence({ capabilityId: 'http.request', data, citations: [], untrusted: true });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    expect(result.evidence).toMatchObject({ truncated: true });
    expect(cycle.self).toBe(cycle);
    expect(data.bytes).toHaveLength(100_000);
  });

  it('bounds JSON-escaped object keys and repeated nested artifact metadata', () => {
    const data = Array.from({ length: 50 }, () => ({
      kind: 'table', rows: [{ ['\u0000'.repeat(2_000)]: 'value' }],
      truncated: false, completeness: { status: 'complete' },
    }));
    const result = boundCapabilityEvidence({ capabilityId: 'http.request', data, citations: [], untrusted: true });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
    expect(result.evidence).toMatchObject({ truncated: true });
    expect(data[0]?.truncated).toBe(false);
  });
});
