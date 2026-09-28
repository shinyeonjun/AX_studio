import {
  ingestOpenApiSpec,
  parseOpenApiConnectionConfig,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';

export async function hydrateOpenApiConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'openapi');
  if (!connection?.connected) return;

  const parsed = parseOpenApiConnectionConfig(connection.config);
  if (!parsed) {
    store.setConnection('openapi', false);
    return;
  }

  try {
    const ingested = ingestOpenApiSpec(parsed.specId, parsed.specJson, parsed.baseUrl);
    runtime.setConnector('openapi', ingested.connector);
  } catch {
    store.setConnection('openapi', false);
  }
}
