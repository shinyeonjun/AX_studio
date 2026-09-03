import {
  parseHttpEndpoints,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { applyHttpConnector } from './apply.js';
import { readHttpSecrets } from './secrets.js';

export async function hydrateHttpConnector(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'http');
  if (!connection?.connected) return;
  const endpoints = parseHttpEndpoints(connection.config);
  if (endpoints.length === 0) {
    store.setConnection('http', false);
    return;
  }
  applyHttpConnector(store, runtime, endpoints, await readHttpSecrets());
}
