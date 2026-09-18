import { describe, expect, it, afterEach, vi } from 'vitest';
import { clearDynamicCatalogForTests } from '../../../catalog/dynamic-catalog.js';
import { getCapability } from '../../../catalog/capabilities.js';
import { invokeReadCapability } from '../../../intelligence/design-tools/capability-invoke.js';
import { buildDesignToolContext } from '../../../intelligence/design-tools/context.js';
import {
  MockMcpClient,
  McpConnector,
  ingestMcpServer,
  parseMcpConnectionConfig,
  parseMcpToolsJson,
} from './index.js';
import { requiresApproval } from '../../../workflow/approval.js';

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
    );
    expect((result.data as { result: { tool: string } }).result.tool).toBe('search_docs');
  });

  it('normalizes tool names from settings input and persisted connections', () => {
    const tools = parseMcpToolsJson('[{"name":"  search_docs  ","description":"Search docs"}]');
    expect(tools).toEqual([{ name: 'search_docs', description: 'Search docs' }]);

    expect(parseMcpConnectionConfig({ serverId: ' demo ', tools })).toEqual({
      serverId: 'demo',
      tools: [{ name: 'search_docs', description: 'Search docs' }],
    });
  });

  it('rejects tool lists whose names are blank after normalization', () => {
    expect(() => parseMcpToolsJson('[{"name":"   "}]')).toThrow('유효한 MCP tool 정의가 없습니다.');
    expect(parseMcpConnectionConfig({ serverId: 'demo', tools: [{ name: '   ' }] })).toBeNull();
  });

  it('drops untrusted side-effect labels instead of treating them as policy', () => {
    expect(parseMcpToolsJson('[{"name":"lookup","sideEffect":"NONE_OR_TRUST_ME"}]')).toEqual([
      { name: 'lookup' },
    ]);
  });

  it('rejects oversized tool arguments before calling an MCP server', async () => {
    const callTool = vi.fn();
    const connector = new McpConnector('demo', {
      listTools: async () => [],
      callTool,
    });

    await expect(connector.execute(
      'demo.lookup',
      { args: { query: 'x'.repeat(1_000_001) } },
      { executionId: 'e1', variables: {}, log: () => undefined },
    )).resolves.toMatchObject({ ok: false, error: 'mcp_arguments_too_large', errorCode: 'invalid_params' });
    expect(callTool).not.toHaveBeenCalled();
  });
});
