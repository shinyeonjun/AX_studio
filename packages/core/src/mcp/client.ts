export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  sideEffect?: 'NONE' | 'REVERSIBLE' | 'EXTERNAL' | 'EXTERNAL_HIGH';
}

export interface McpClient {
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export class MockMcpClient implements McpClient {
  constructor(private readonly tools: McpToolDefinition[]) {}

  async listTools(): Promise<McpToolDefinition[]> {
    return [...this.tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.find((entry) => entry.name === name);
    if (!tool) throw new Error('mcp_tool_not_found');
    return { tool: name, args, echo: true };
  }
}
