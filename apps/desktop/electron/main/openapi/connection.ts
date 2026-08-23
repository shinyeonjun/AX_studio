import {
  ingestOpenApiSpec,
  parseOpenApiConnectionConfig,
  loadOpenApiSpecFromUrl,
  validateOpenApiSpecJson,
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

  const ingested = ingestOpenApiSpec(parsed.specId, parsed.specJson);
  runtime.setConnector('openapi', ingested.connector);
}

export async function validateAndConnectOpenApi(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: {
    specId: string;
    label?: string;
    specUrl?: string;
    specJson?: string;
  },
): Promise<void> {
  const specId = payload.specId.trim();
  if (!specId) throw new Error('OpenAPI spec ID가 필요합니다.');

  let raw: unknown;
  if (payload.specUrl?.trim()) {
    raw = await loadOpenApiSpecFromUrl(payload.specUrl);
  } else if (payload.specJson?.trim()) {
    try {
      raw = JSON.parse(payload.specJson);
    } catch {
      throw new Error('OpenAPI spec JSON 파싱에 실패했습니다.');
    }
  } else {
    throw new Error('spec URL 또는 JSON 본문이 필요합니다.');
  }

  const validated = validateOpenApiSpecJson(specId, raw);
  const ingested = ingestOpenApiSpec(validated.specId, raw);

  store.setConnection('openapi', true, {
    specId: validated.specId,
    label: payload.label?.trim() || undefined,
    baseUrl: validated.baseUrl,
    specUrl: payload.specUrl?.trim() || undefined,
    specJson: raw,
    operationCount: validated.operationCount,
    connectedAt: new Date().toISOString(),
    lastError: undefined,
  });
  runtime.setConnector('openapi', ingested.connector);
}

export async function disconnectOpenApi(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  store.setConnection('openapi', false);
  runtime.setConnector('openapi', null);
}
