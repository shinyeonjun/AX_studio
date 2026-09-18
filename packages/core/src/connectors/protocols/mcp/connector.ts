import type { Connector, ConnectorContext, ConnectorResult } from '../../types.js';
import type { McpClient } from './client.js';

const MAX_MCP_CALL_BYTES = 1_000_000;

export class McpConnector implements Connector {
  name = 'mcp';

  constructor(
    private readonly serverId: string,
    private readonly client: McpClient,
  ) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const toolName = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
    try {
      let encodedParams: string | undefined;
      try {
        encodedParams = JSON.stringify(params);
      } catch {
        return { ok: false, error: 'mcp_arguments_not_serializable', errorCode: 'invalid_params' };
      }
      if (encodedParams === undefined || Buffer.byteLength(encodedParams, 'utf8') > MAX_MCP_CALL_BYTES) {
        return { ok: false, error: 'mcp_arguments_too_large', errorCode: 'invalid_params' };
      }
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
