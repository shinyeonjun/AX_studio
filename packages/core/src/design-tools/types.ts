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
  'workflow.inspect',
  'workflows.list',
  'workflows.run',
] as const;

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

/** Shared structured-output contract for every read-only design-tool caller. */
export const DesignToolCallSchema = z.object({
  tool: z.enum(DESIGN_TOOL_IDS),
  args: z.preprocess(parseToolArgs, z.record(z.unknown()).optional()),
});

export type ParsedDesignToolCall = z.infer<typeof DesignToolCallSchema>;

export type DesignToolId = (typeof DESIGN_TOOL_IDS)[number];

export interface DesignToolCall {
  tool: DesignToolId;
  args?: Record<string, unknown>;
}

export interface WorkflowListItem {
  id: string;
  name: string;
  active: boolean;
}

export interface WorkflowRunResult {
  executionId: string;
  status: string;
  errorCode?: string;
}

export interface WorkflowToolActions {
  list(): WorkflowListItem[] | Promise<WorkflowListItem[]>;
  run(workflowId: string): WorkflowRunResult | Promise<WorkflowRunResult>;
}

export interface DesignToolContext {
  connections: ConnectionRecord[];
  connectedConnectorIds: string[];
  interactionMode?: InteractionMode;
  workflowActions?: WorkflowToolActions;
  /**
   * Allows bounded untrusted source content to enter the current model turn.
   * Keep this false for cloud providers unless the caller has an explicit
   * product-level consent policy.
   */
  allowUntrustedData?: boolean;
  /** Runtime connector instances for read-only capability invoke. */
  connectors?: Record<string, Connector>;
  /** Optional draft context. Authoring agents get it; read-only workspace chat does not. */
  workflow?: {
    revision: number;
    draft: unknown;
    completeness: unknown;
  };
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
