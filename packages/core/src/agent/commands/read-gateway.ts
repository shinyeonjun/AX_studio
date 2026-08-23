import { buildDesignToolContext } from '../../design-tools/context.js';
import { executeDesignTool } from '../../design-tools/execute.js';
import type { DesignToolContext, DesignToolId, DesignToolResult } from '../../design-tools/types.js';
import type { WorkflowStore } from '../../store/workflow-store.js';

export type AxCommandReadTool = Extract<
  DesignToolId,
  | 'sources.list'
  | 'sources.files.list'
  | 'sources.file.read'
  | 'sources.search'
  | 'capabilities.invoke'
>;

export type AxCommandReadContext = DesignToolContext;

export interface AxCommandReadGateway {
  execute(
    request: { tool: AxCommandReadTool; args: Record<string, unknown> },
    context?: AxCommandReadContext,
  ): Promise<DesignToolResult>;
}

/**
 * Adapter boundary for source/capability reads.
 *
 * AxCommandService depends on this narrow read contract instead of the
 * design-tool registry. The default adapter keeps the existing guarded
 * handlers, while tests and future command transports can provide another
 * implementation without importing design-tools into command dispatch.
 */
export function createDesignToolReadGateway(store: WorkflowStore): AxCommandReadGateway {
  return {
    execute: async (request, context) => executeDesignTool(
      { tool: request.tool, args: request.args },
      context ?? defaultReadContext(store),
    ),
  };
}

function defaultReadContext(store: WorkflowStore): DesignToolContext {
  const connections = store.getConnections();
  return buildDesignToolContext(
    connections,
    connections.filter((entry) => entry.connected).map((entry) => entry.connector),
    { allowUntrustedData: true },
  );
}
