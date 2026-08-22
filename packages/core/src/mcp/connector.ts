import type { Connector, ConnectorContext, ConnectorResult } from '../modules/types.js';
import type { McpClient } from './client.js';

export class McpConnector implements Connector {
  name = 'mcp';

  constructor(
    private readonly serverId: string,
    private readonly client: McpClient,
  ) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const toolName = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
    try {
      const data = await this.client.callTool(toolName, params);
      ctx.log({
        at: new Date().toISOString(),
        level: 'info',
        message: 'mcp.tool_call',
        data: { serverId: this.serverId, tool: toolName },
      });
      return { ok: true, data: { result: data, untrusted: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.log({
        at: new Date().toISOString(),
        level: 'error',
        message: 'mcp.tool_call_failed',
        data: { serverId: this.serverId, tool: toolName, error: message },
      });
      return { ok: false, error: message, errorCode: 'mcp_tool_call_failed' };
    }
  }
}
