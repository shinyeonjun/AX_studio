import type { McpToolDefinition } from './client.js';

interface McpConnectionRecord {
  serverId?: string;
  label?: string;
  tools?: McpToolDefinition[];
  connectedAt?: string;
  lastError?: string;
  toolCount?: number;
}

export interface McpConnectionConfig {
  serverId: string;
  label?: string;
  tools: McpToolDefinition[];
}

const MAX_MCP_TOOLS = 200;
const MAX_MCP_INPUT_BYTES = 2_000_000;
const MAX_MCP_DESCRIPTION_CHARS = 8_000;
const MAX_MCP_SCHEMA_BYTES = 128_000;
const MCP_SIDE_EFFECTS = new Set(['NONE', 'REVERSIBLE', 'EXTERNAL', 'EXTERNAL_HIGH']);

function boundedSchema(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_MCP_SCHEMA_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeToolDefinition(value: unknown): McpToolDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tool = value as McpToolDefinition;
  if (typeof tool.name !== 'string') return null;
  const name = tool.name.trim();
  if (!name || name.length > 128) return null;
  const description = typeof tool.description === 'string'
    ? tool.description.trim().slice(0, MAX_MCP_DESCRIPTION_CHARS)
    : undefined;
  const inputSchema = tool.inputSchema === undefined ? undefined : boundedSchema(tool.inputSchema);
  if (tool.inputSchema !== undefined && !inputSchema) return null;
  const sideEffect = typeof tool.sideEffect === 'string' && MCP_SIDE_EFFECTS.has(tool.sideEffect)
    ? tool.sideEffect as McpToolDefinition['sideEffect']
    : undefined;
  return {
    name,
    ...(description ? { description } : {}),
    ...(inputSchema ? { inputSchema } : {}),
    ...(sideEffect ? { sideEffect } : {}),
  };
}

export function parseMcpConnectionConfig(config: unknown): McpConnectionConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as McpConnectionRecord;
  const serverId = typeof record.serverId === 'string' ? record.serverId.trim() : '';
  if (!serverId) return null;
  if (!Array.isArray(record.tools) || record.tools.length === 0 || record.tools.length > MAX_MCP_TOOLS) return null;
  const tools = record.tools.map(normalizeToolDefinition).filter((tool) => tool !== null);
  if (tools.length === 0) return null;
  return {
    serverId,
    label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
    tools,
  };
}

export function parseMcpToolsJson(raw: string): McpToolDefinition[] {
  if (Buffer.byteLength(raw, 'utf8') > MAX_MCP_INPUT_BYTES) {
    throw new Error('MCP tools JSON이 너무 큽니다.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MCP tools JSON 파싱에 실패했습니다.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_MCP_TOOLS) {
    throw new Error('MCP tools 배열이 필요합니다.');
  }
  const tools = parsed.map(normalizeToolDefinition).filter((tool) => tool !== null);
  if (tools.length === 0) throw new Error('유효한 MCP tool 정의가 없습니다.');
  return tools;
}
