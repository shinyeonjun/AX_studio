export interface ConnectionRecord {
  connector: string;
  connected: boolean;
  config?: unknown;
}

export const DESIGN_TOOL_IDS = [
  'connections.list',
  'sources.list',
  'sources.files.list',
  'capabilities.list',
  'capabilities.describe',
] as const;

export type DesignToolId = (typeof DESIGN_TOOL_IDS)[number];

export interface DesignToolCall {
  tool: DesignToolId;
  args?: Record<string, unknown>;
}

export interface DesignToolContext {
  connections: ConnectionRecord[];
  connectedConnectorIds: string[];
}

export interface DesignToolResult {
  tool: DesignToolId;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type DesignToolHandler = (
  ctx: DesignToolContext,
  args: Record<string, unknown>,
) => DesignToolResult['data'] | Promise<DesignToolResult['data']>;
