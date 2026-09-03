import { describe, expect, it } from 'vitest';
import { buildDesignToolContext, executeDesignToolCalls } from './index.js';

describe('design-tools capabilities', () => {
  it('describes capabilities for connected connectors', async () => {
    const ctx = buildDesignToolContext([], ['document', 'local_sheet']);
    const results = await executeDesignToolCalls(
      [
        { tool: 'capabilities.list', args: { connector: 'document' } },
        { tool: 'capabilities.describe', args: { id: 'document.ingest' } },
      ],
      ctx,
    );

    expect(results[0]?.ok).toBe(true);
    expect(JSON.stringify(results[0]?.data)).toContain('document.ingest');
    expect(results[1]?.ok).toBe(true);
    expect(JSON.stringify(results[1]?.data)).toContain('"available":true');
  });

  it('lists packaged actions before connector authentication', async () => {
    const results = await executeDesignToolCalls(
      [{ tool: 'capabilities.list', args: { kind: 'write' } }],
      buildDesignToolContext([], ['document']),
    );

    expect(results[0]?.ok).toBe(true);
    const data = results[0]?.data as { capabilities: Array<{ id: string; connection: string }> };
    expect(data.capabilities.some((cap) => cap.id === 'gmail.message.send' && cap.connection === 'required')).toBe(true);
    expect(data.capabilities.some((cap) => cap.id === 'slack.message.send' && cap.connection === 'required')).toBe(true);
  });
});
