import type { McpToolDefinition } from './client.js';

export interface McpConnectionRecord {
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

function normalizeToolDefinition(value: unknown): McpToolDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tool = value as McpToolDefinition;
  if (typeof tool.name !== 'string') return null;
  const name = tool.name.trim();
  return name ? { ...tool, name } : null;
}

export function parseMcpConnectionConfig(config: unknown): McpConnectionConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as McpConnectionRecord;
  const serverId = typeof record.serverId === 'string' ? record.serverId.trim() : '';
  if (!serverId) return null;
  if (!Array.isArray(record.tools) || record.tools.length === 0) return null;
  const tools = record.tools.map(normalizeToolDefinition).filter((tool) => tool !== null);
  if (tools.length === 0) return null;
  return {
    serverId,
    label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
    tools,
  };
}

export function parseMcpToolsJson(raw: string): McpToolDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('MCP tools JSON 파싱에 실패했습니다.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('MCP tools 배열이 필요합니다.');
  }
  const tools = parsed.map(normalizeToolDefinition).filter((tool) => tool !== null);
  if (tools.length === 0) throw new Error('유효한 MCP tool 정의가 없습니다.');
  return tools;
}
