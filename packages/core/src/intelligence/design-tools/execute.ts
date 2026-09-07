import { CapabilityInvokeError } from './capability-invoke.js';
import { getDesignTool } from './registry.js';
import type { DesignToolCall, DesignToolContext, DesignToolId, DesignToolResult } from './types.js';
import { DESIGN_TOOL_IDS, MAX_DESIGN_TOOL_CALLS_PER_TURN } from './types.js';

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
    const error = err instanceof Error ? err.message : String(err);
    const errorDetails =
      err instanceof CapabilityInvokeError && ctx.allowUntrustedData === true
        ? err.errorDetails
        : undefined;
    return {
      tool: call.tool,
      ok: false,
      error,
      ...(errorDetails === undefined ? {} : { errorDetails }),
    };
  }
}

export async function executeDesignToolCalls(
  calls: DesignToolCall[],
  ctx: DesignToolContext,
): Promise<DesignToolResult[]> {
  if (calls.length > MAX_DESIGN_TOOL_CALLS_PER_TURN) {
    throw new Error(`too_many_design_tool_calls:${MAX_DESIGN_TOOL_CALLS_PER_TURN}`);
  }
  const results: DesignToolResult[] = [];
  for (const call of calls) {
    results.push(await executeDesignTool(call, ctx));
  }
  return results;
}

export function formatDesignToolResults(results: DesignToolResult[]): string {
  const serialized = JSON.stringify(results, null, 2);
  const maxChars = 60_000;
  return serialized.length <= maxChars
    ? serialized
    : `${serialized.slice(0, maxChars)}\n...[design-tool results truncated]`;
}
