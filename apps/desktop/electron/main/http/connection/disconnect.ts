import {
  removeHttpEndpoint,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { applyHttpConnector } from './apply.js';
import { readHttpSecrets, writeHttpSecrets } from './secrets.js';

export async function disconnectHttp(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  endpointId?: string,
): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'http');
  const remaining = endpointId?.trim()
    ? removeHttpEndpoint(connection?.config, endpointId)
    : [];
  const secrets = await readHttpSecrets();
  if (endpointId?.trim()) {
    delete secrets[endpointId.trim()];
  } else {
    for (const key of Object.keys(secrets)) delete secrets[key];
  }
  await writeHttpSecrets(remaining.length === 0 ? {} : secrets);
  applyHttpConnector(store, runtime, remaining, secrets);
}
