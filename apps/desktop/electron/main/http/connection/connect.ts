import {
  DEFAULT_HTTP_ENDPOINT_ID,
  normalizeHttpBaseUrl,
  parseHttpEndpoints,
  probeHttpBaseUrl,
  upsertHttpEndpoint,
  type HttpEndpointSecrets,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { randomUUID } from 'node:crypto';
import { applyHttpConnector } from './apply.js';
import { buildHttpAuth, type HttpConnectionPayload } from './auth.js';
import { httpProbeErrorMessage } from './probe-message.js';
import { readHttpSecrets, writeHttpSecrets } from './secrets.js';

export async function validateAndConnectHttp(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: HttpConnectionPayload,
): Promise<void> {
  const normalized = normalizeHttpBaseUrl(payload.baseUrl);
  if (!normalized.ok) {
    throw new Error(httpProbeErrorMessage(normalized.error));
  }
  const baseUrl = normalized.value;

  const connection = store.getConnections().find((entry) => entry.connector === 'http');
  const existing = parseHttpEndpoints(connection?.config);
  const secrets = await readHttpSecrets();
  const requestedId = payload.endpointId?.trim();
  const matched = requestedId
    ? existing.find((entry) => entry.id === requestedId)
    : existing.find((entry) => entry.baseUrl.replace(/\/$/, '') === baseUrl.replace(/\/$/, ''));
  const endpointId = matched?.id ?? (existing.length === 0 ? DEFAULT_HTTP_ENDPOINT_ID : randomUUID());
  const auth = buildHttpAuth(payload, secrets[endpointId]);

  const probe = await probeHttpBaseUrl(baseUrl, payload.authType === 'none' ? undefined : auth);
  if (!probe.ok) {
    throw new Error(httpProbeErrorMessage(probe.error));
  }

  const nextSecrets: HttpEndpointSecrets = { ...secrets };
  if (payload.authType === 'none') {
    delete nextSecrets[endpointId];
  } else {
    nextSecrets[endpointId] = {
      token: payload.authType === 'bearer' || payload.authType === 'apiKey' ? auth.token : undefined,
      password: payload.authType === 'basic' ? auth.password : undefined,
    };
  }
  await writeHttpSecrets(nextSecrets);

  const next = upsertHttpEndpoint(connection?.config, {
    id: endpointId,
    baseUrl,
    label: payload.label?.trim() || undefined,
    auth,
    authStored: payload.authType !== 'none',
    connectedAt: new Date().toISOString(),
  });
  applyHttpConnector(store, runtime, next, nextSecrets);
}
