import { z } from 'zod';

import type { InteractionMode } from '../platform/mode-policy.js';
import type { Connector } from '../modules/types.js';

export interface ConnectionRecord {
  connector: string;
  connected: boolean;
  config?: unknown;
}

export const DESIGN_TOOL_IDS = [
  'tools.list',
  'connections.list',
  'sources.list',
  'sources.files.list',
  'sources.file.read',
  'sources.search',
  'capabilities.list',
  'capabilities.describe',
  'capabilities.invoke',
] as const;

export type DesignToolId = (typeof DESIGN_TOOL_IDS)[number];

export interface DesignToolCall {
  tool: DesignToolId;
  args?: Record<string, unknown>;
}

/** Keep one model turn bounded across structured and native tool protocols. */
export const MAX_DESIGN_TOOL_CALLS_PER_TURN = 5;

function parseToolArgs(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function designToolIdFromAlias(name: string): DesignToolId | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if ((DESIGN_TOOL_IDS as readonly string[]).includes(trimmed)) {
    return trimmed as DesignToolId;
  }
  const dotted = trimmed.replace(/_/g, '.');
  if ((DESIGN_TOOL_IDS as readonly string[]).includes(dotted)) {
    return dotted as DesignToolId;
  }
  return undefined;
}

function readToolArgs(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const argsRaw = record.args ?? record.input ?? record.arguments ?? record.parameters;
  if (argsRaw == null) return undefined;
  if (typeof argsRaw === 'string') {
    const parsed = parseToolArgs(argsRaw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  }
  if (typeof argsRaw === 'object' && !Array.isArray(argsRaw)) {
    return argsRaw as Record<string, unknown>;
  }
  return undefined;
}

/** Accept canonical `{ tool }` plus common provider aliases (`name`, `id`, function wrappers). */
export function coerceDesignToolCall(raw: unknown): DesignToolCall | undefined {
  if (typeof raw === 'string') {
    const tool = designToolIdFromAlias(raw);
    return tool ? { tool } : undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const record = raw as Record<string, unknown>;
  if (record.type === 'function' && record.function && typeof record.function === 'object') {
    return coerceDesignToolCall(record.function);
  }
  if (record.function && typeof record.function === 'object') {
    return coerceDesignToolCall(record.function);
  }

  const alias =
    typeof record.tool === 'string'
      ? record.tool
      : typeof record.name === 'string'
        ? record.name
        : typeof record.id === 'string'
          ? record.id
          : undefined;
  if (!alias) return undefined;

  const tool = designToolIdFromAlias(alias);
  if (!tool) return undefined;

  const args = readToolArgs(record);
  return args ? { tool, args } : { tool };
}

export function parseDesignToolCalls(raw: unknown): DesignToolCall[] {
  const value = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return z.array(DesignToolCallSchema).parse(value);
}

/** Shared structured-output contract for every read-only design-tool caller. */
export const DesignToolCallSchema = z.preprocess(
  (raw) => coerceDesignToolCall(raw) ?? raw,
  z.object({
    tool: z.enum(DESIGN_TOOL_IDS),
    args: z.preprocess(parseToolArgs, z.record(z.unknown()).optional()),
  }),
);

export type ParsedDesignToolCall = z.infer<typeof DesignToolCallSchema>;

export interface DesignToolContext {
  connections: ConnectionRecord[];
  connectedConnectorIds: string[];
  interactionMode?: InteractionMode;
  /**
   * Allows bounded untrusted source content to enter the current model turn.
   * The host sets this true by default because the product policy allows
   * configured providers to analyze locally extracted document evidence.
   * A caller may set it false for an explicit privacy restriction.
   */
  allowUntrustedData?: boolean;
  /** Runtime connector instances for read-only capability invoke. */
  connectors?: Record<string, Connector>;
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
