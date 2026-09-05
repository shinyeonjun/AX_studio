import type { ConnectorContext, ExecutionLogEntry } from '../../modules/types.js';
import { resolveFileRef } from '../source-resolver.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import type { WorkflowExecutionHost } from './contracts.js';

export function createConnectorContext(
  host: WorkflowExecutionHost,
  executionId: string,
  workflowId: string | undefined,
  variables: Record<string, unknown>,
  connections: ReturnType<WorkflowStore['getConnections']>,
  log: (entry: ExecutionLogEntry) => void,
  workspaceSessionId?: string,
): ConnectorContext {
  return {
    executionId,
    workflowId,
    ...(workspaceSessionId ? { workspaceSessionId } : {}),
    variables,
    outputs: {},
    connections,
    artifactSink: host.config.artifactSink,
    resolveFileRef: (file) => {
      const resolved = resolveFileRef(file, connections);
      return resolved.ok
        ? { ok: true, path: resolved.path, file: resolved.file }
        : { ok: false, error: resolved.error, errorCode: resolved.errorCode };
    },
    log,
  };
}
