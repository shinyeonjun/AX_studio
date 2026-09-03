import {
  HttpConnector,
  mergeHttpEndpointsWithSecrets,
  serializeHttpEndpoints,
  type HttpEndpoint,
  type HttpEndpointSecrets,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';

export function applyHttpConnector(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  endpoints: HttpEndpoint[],
  secrets: HttpEndpointSecrets,
): void {
  const merged = mergeHttpEndpointsWithSecrets(endpoints, secrets);
  // Persist the full endpoint list (secrets never serialize) so a missing OS
  // secret degrades to "disconnected" instead of silently erasing endpoints.
  const config = endpoints.length > 0 ? serializeHttpEndpoints(endpoints) : undefined;
  if (merged.length === 0) {
    store.setConnection('http', false, config);
    runtime.setConnector('http', null);
    return;
  }
  store.setConnection('http', true, config);
  runtime.setConnector('http', new HttpConnector(merged));
}
