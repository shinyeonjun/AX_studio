import { describe, expect, it, afterEach } from 'vitest';
import { clearDynamicCatalogForTests } from '../catalog/dynamic-catalog.js';
import { getCapability } from '../catalog/capabilities.js';
import { invokeReadCapability } from '../design-tools/capability-invoke.js';
import { buildDesignToolContext } from '../design-tools/context.js';
import { MockMcpClient, ingestMcpServer } from './index.js';
import { requiresApproval } from '../workflow/approval.js';

describe('mcp ingest', () => {
  afterEach(() => {
    clearDynamicCatalogForTests();
  });

  it('registers tools and calls them through the MCP connector adapter', async () => {
    const client = new MockMcpClient([
      { name: 'search_docs', description: 'Search docs', sideEffect: 'NONE' },
      { name: 'send_alert', description: 'Send alert', sideEffect: 'EXTERNAL' },
    ]);
    const { connector, capabilityIds } = await ingestMcpServer('demo', client);
    expect(capabilityIds).toContain('mcp.demo.search_docs');
    expect(getCapability('mcp.demo.send_alert')?.sideEffect).toBe('EXTERNAL');
    expect(requiresApproval('EXTERNAL', false)).toBe(true);

    const ctx = buildDesignToolContext([], ['mcp'], {
      connectors: { mcp: connector },
    });
    const result = await invokeReadCapability(
      ctx,
      'mcp.demo.search_docs',
      { args: { q: 'deploy' } },
      'plain_chat',
    );
    expect((result.data as { result: { tool: string } }).result.tool).toBe('search_docs');
  });
});
