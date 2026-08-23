import {
  ingestMcpServer,
  MockMcpClient,
  parseMcpConnectionConfig,
  parseMcpToolsJson,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';

export async function hydrateMcpConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'mcp');
  if (!connection?.connected) return;

  const parsed = parseMcpConnectionConfig(connection.config);
  if (!parsed) {
    store.setConnection('mcp', false);
    return;
  }

  const ingested = await ingestMcpServer(parsed.serverId, new MockMcpClient(parsed.tools));
  runtime.setConnector('mcp', ingested.connector);
}

export async function validateAndConnectMcp(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: {
    serverId: string;
    label?: string;
    toolsJson: string;
  },
): Promise<void> {
  const serverId = payload.serverId.trim();
  if (!serverId) throw new Error('MCP server ID가 필요합니다.');

  const tools = parseMcpToolsJson(payload.toolsJson);
  const ingested = await ingestMcpServer(serverId, new MockMcpClient(tools));

  store.setConnection('mcp', true, {
    serverId,
    label: payload.label?.trim() || undefined,
    tools,
    toolCount: tools.length,
    connectedAt: new Date().toISOString(),
    lastError: undefined,
  });
  runtime.setConnector('mcp', ingested.connector);
}

export async function disconnectMcp(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  store.setConnection('mcp', false);
  runtime.setConnector('mcp', null);
}
