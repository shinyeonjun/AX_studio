import { executeDesignTool } from '../design-tools/execute.js';
import type { DesignToolCall, DesignToolContext, DesignToolResult } from '../design-tools/types.js';

export interface ToolInvokeRequest {
  tool: DesignToolCall['tool'];
  args?: Record<string, unknown>;
}

export interface ToolInvoker {
  invoke(request: ToolInvokeRequest, ctx: DesignToolContext): Promise<DesignToolResult>;
}

/** First-party adapter: design-tools registry behind a stable invoke boundary. */
export const designToolInvoker: ToolInvoker = {
  invoke(request, ctx) {
    return executeDesignTool({ tool: request.tool, args: request.args }, ctx);
  },
};

export function invokeDesignTool(
  request: ToolInvokeRequest,
  ctx: DesignToolContext,
): Promise<DesignToolResult> {
  return designToolInvoker.invoke(request, ctx);
}
