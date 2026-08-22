import type { ConnectorCapability } from '../catalog/capability-types.js';
import { registerDynamicCapabilities } from '../catalog/dynamic-catalog.js';
import type { McpClient, McpToolDefinition } from './client.js';
import { McpConnector } from './connector.js';

function capabilityFromTool(serverId: string, tool: McpToolDefinition): ConnectorCapability {
  const sideEffect = tool.sideEffect ?? 'EXTERNAL';
  return {
    id: `mcp.${serverId}.${tool.name}`,
    connector: 'mcp',
    kind: sideEffect === 'NONE' || sideEffect === 'REVERSIBLE' ? 'read' : 'write',
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
  registerDynamicCapabilities(capabilities);
  return {
    connector: new McpConnector(serverId, client),
    capabilityIds: capabilities.map((cap) => cap.id),
  };
}
