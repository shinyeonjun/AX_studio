import type { SideEffectLevel } from '../workflow/schema.js';
import { defaultSideEffectForHttpMethod } from '../platform/side-effect-policy.js';
import type { ConnectorCapability } from '../catalog/capability-types.js';

export interface OpenApiOperation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  sideEffect?: SideEffectLevel;
}

export interface OpenApiSpec {
  id: string;
  title: string;
  baseUrl: string;
  operations: OpenApiOperation[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function operationSideEffect(method: string, operation: Record<string, unknown>): SideEffectLevel {
  const explicit = operation['x-sideEffect'];
  if (
    explicit === 'NONE' ||
    explicit === 'REVERSIBLE' ||
    explicit === 'EXTERNAL' ||
    explicit === 'EXTERNAL_HIGH'
  ) {
    return explicit;
  }
  return defaultSideEffectForHttpMethod(method);
}

/** Minimal OpenAPI 3 parser for fixture specs and settings ingest. */
export function parseOpenApiSpec(id: string, raw: unknown): OpenApiSpec {
  const root = asRecord(raw);
  if (!root) throw new Error('openapi_spec_invalid');

  const servers = Array.isArray(root.servers) ? root.servers : [];
  const firstServer = asRecord(servers[0]);
  const baseUrl = typeof firstServer?.url === 'string' ? firstServer.url.replace(/\/$/, '') : '';
  if (!baseUrl) throw new Error('openapi_base_url_required');

  const paths = asRecord(root.paths);
  if (!paths) throw new Error('openapi_paths_required');

  const operations: OpenApiOperation[] = [];
  const operationIds = new Set<string>();
  for (const [path, pathItem] of Object.entries(paths)) {
    const item = asRecord(pathItem);
    if (!item) continue;
    for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete']) {
      const operation = asRecord(item[method]);
      if (!operation) continue;
      const operationId =
        typeof operation.operationId === 'string' && operation.operationId.trim()
          ? operation.operationId.trim()
          : `${method}_${path.replace(/[^\w]+/g, '_')}`;
      if (operationIds.has(operationId)) throw new Error('openapi_operation_id_duplicate');
      operationIds.add(operationId);
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: typeof operation.summary === 'string' ? operation.summary : undefined,
        sideEffect: operationSideEffect(method, operation),
      });
    }
  }

  if (!operations.length) throw new Error('openapi_operations_empty');

  const info = asRecord(root.info);
  const title = typeof info?.title === 'string' && info.title.trim() ? info.title.trim() : id;
  return { id, title, baseUrl, operations };
}

export function openApiCapabilitiesFromSpec(spec: OpenApiSpec): ConnectorCapability[] {
  return spec.operations.map((operation) => ({
    id: `openapi.${spec.id}.${operation.operationId}`,
    connector: 'openapi',
    kind: operation.sideEffect === 'NONE' || operation.sideEffect === 'REVERSIBLE' ? 'read' : 'write',
    label: operation.summary ?? operation.operationId,
    description: `${operation.method} ${operation.path}`,
    sideEffect: operation.sideEffect ?? defaultSideEffectForHttpMethod(operation.method),
    params: [
      { name: 'pathParams', label: 'Path params', question: '경로 변수를 입력하세요.', required: false },
      { name: 'query', label: 'Query', question: '쿼리 파라미터를 입력하세요.', required: false },
      { name: 'body', label: 'Body', question: '요청 본문을 입력하세요.', required: false },
    ],
  }));
}
