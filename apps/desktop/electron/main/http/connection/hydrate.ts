import {
  discoverHttpReadOperations,
  mergeHttpEndpointsWithSecrets,
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
  const secrets = await readHttpSecrets();
  const authenticated = new Map(mergeHttpEndpointsWithSecrets(endpoints, secrets)
    .map((endpoint) => [endpoint.id, endpoint]));
  const hydrated = await Promise.all(endpoints.map(async (endpoint) => {
    if (endpoint.discoveredReadOperations !== undefined) return endpoint;
    const usable = authenticated.get(endpoint.id);
    if (!usable) return endpoint;
    try {
      return {
        ...endpoint,
        discoveredReadOperations: await discoverHttpReadOperations(endpoint.baseUrl, usable.auth),
      };
    } catch {
      return endpoint;
    }
  }));
  applyHttpConnector(store, runtime, hydrated, secrets);
}
