import {
  discoverHttpReadOperations,
  mergeHttpEndpointsWithSecrets,
  parseHttpEndpoints,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { applyHttpConnector } from './apply.js';
import { withHttpConnectionLock } from './lock.js';
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
  const discovered = new Map(hydrated
    .filter((endpoint) => endpoint.discoveredReadOperations !== undefined)
    .map((endpoint) => [endpoint.id, endpoint]));
  // Discovery is slow; apply against the latest persisted state so a connect or
  // disconnect that finished meanwhile is not overwritten.
  await withHttpConnectionLock(async () => {
    const latest = store.getConnections().find((entry) => entry.connector === 'http');
    if (!latest?.connected) return;
    const latestEndpoints = parseHttpEndpoints(latest.config).map((endpoint) => {
      const found = discovered.get(endpoint.id);
      return endpoint.discoveredReadOperations === undefined && found?.baseUrl === endpoint.baseUrl
        ? { ...endpoint, discoveredReadOperations: found.discoveredReadOperations }
        : endpoint;
    });
    applyHttpConnector(store, runtime, latestEndpoints, await readHttpSecrets());
  });
}
