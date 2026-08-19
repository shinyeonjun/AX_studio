import { getDesignTool } from './registry.js';
import type { DesignToolCall, DesignToolContext, DesignToolId, DesignToolResult } from './types.js';
import { DESIGN_TOOL_IDS } from './types.js';

function isDesignToolId(value: string): value is DesignToolId {
  return (DESIGN_TOOL_IDS as readonly string[]).includes(value);
}

export async function executeDesignTool(
  call: DesignToolCall,
  ctx: DesignToolContext,
): Promise<DesignToolResult> {
  if (!isDesignToolId(call.tool)) {
    return { tool: call.tool as DesignToolId, ok: false, error: 'unknown_tool' };
  }

  const definition = getDesignTool(call.tool);
  if (!definition) {
    return { tool: call.tool, ok: false, error: 'unknown_tool' };
  }

  try {
    const data = await definition.handler(ctx, call.args ?? {});
    return { tool: call.tool, ok: true, data };
  } catch (err) {
    return {
      tool: call.tool,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeDesignToolCalls(
  calls: DesignToolCall[],
  ctx: DesignToolContext,
): Promise<DesignToolResult[]> {
  const results: DesignToolResult[] = [];
  for (const call of calls) {
    results.push(await executeDesignTool(call, ctx));
  }
  return results;
}

export function formatDesignToolResults(results: DesignToolResult[]): string {
  return JSON.stringify(results, null, 2);
}
