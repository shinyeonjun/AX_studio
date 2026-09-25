import type { ConnectorCapability } from '../../../catalog/capability-types.js';
import { replaceDynamicCapabilitiesForConnector } from '../../../catalog/dynamic-catalog.js';
import type { McpClient, McpToolDefinition } from './client.js';
import { McpConnector } from './connector.js';

function capabilityFromTool(serverId: string, tool: McpToolDefinition): ConnectorCapability {
  const sideEffect = tool.sideEffect ?? 'EXTERNAL';
  return {
    id: `mcp.${serverId}.${tool.name}`,
    connector: 'mcp',
    // Reversible still changes external state and must stay behind the write
    // approval path. Only an explicit NONE declaration is a chat read.
    kind: sideEffect === 'NONE' ? 'read' : 'write',
    label: tool.name,
    description: tool.description ?? `MCP tool ${tool.name}`,
    sideEffect,
    params: [{ name: 'args', label: 'Arguments', question: '도구 인자를 입력하세요.', required: false }],
  };
}

export interface McpIngestResult {
  connector: McpConnector;
  capabilityIds: string[];
}

export async function ingestMcpServer(serverId: string, client: McpClient): Promise<McpIngestResult> {
  const tools = await client.listTools();
  if (!tools.length) throw new Error('mcp_tools_empty');
  const capabilities = tools.map((tool) => capabilityFromTool(serverId, tool));
  replaceDynamicCapabilitiesForConnector('mcp', capabilities);
  return {
    connector: new McpConnector(serverId, client),
    capabilityIds: capabilities.map((cap) => cap.id),
  };
}
