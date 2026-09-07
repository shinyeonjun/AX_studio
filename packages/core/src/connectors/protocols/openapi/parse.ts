import type { SideEffectLevel } from '../../../workflow/schema.js';
import { defaultSideEffectForHttpMethod } from '../../../platform/side-effect-policy.js';
import type { ConnectorCapability } from '../../../catalog/capability-types.js';

export type OpenApiParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export interface OpenApiField {
  name: string;
  type?: string;
  format?: string;
  description?: string;
  required?: boolean;
}

export interface OpenApiParameter {
  name: string;
  in: OpenApiParameterLocation;
  required: boolean;
  type?: string;
  format?: string;
  description?: string;
}

export interface OpenApiRequestBody {
  required: boolean;
  contentTypes: string[];
  fields: OpenApiField[];
}

export interface OpenApiResponse {
  status: string;
  description?: string;
  contentTypes: string[];
  fields: OpenApiField[];
}

export interface OpenApiOperation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  sideEffect?: SideEffectLevel;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: OpenApiResponse[];
}

export interface OpenApiSpec {
  id: string;
  title: string;
  baseUrl: string;
  operations: OpenApiOperation[];
}

const MAX_OPERATIONS = 200;
const MAX_PARAMETERS = 50;
const MAX_FIELDS = 100;
const MAX_RESPONSES = 50;
const MAX_CONTENT_TYPES = 20;
const MAX_TEXT_LENGTH = 500;

function boundedText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
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

function schemaType(schema: Record<string, unknown> | null): string | undefined {
  return boundedText(schema?.type, 80);
}

function schemaFormat(schema: Record<string, unknown> | null): string | undefined {
  return boundedText(schema?.format, 80);
}

function fieldsFromSchema(
  value: unknown,
  prefix = '',
  depth = 0,
): OpenApiField[] {
  const schema = asRecord(value);
  if (!schema) return [];
  const properties = asRecord(schema.properties);
  if (!properties) return [];
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [],
  );
  const fields: OpenApiField[] = [];
  for (const [name, rawField] of Object.entries(properties)) {
    if (fields.length >= MAX_FIELDS) break;
    const fieldSchema = asRecord(rawField);
    const fieldName = prefix ? `${prefix}.${name}` : name;
    const type = schemaType(fieldSchema);
    const format = schemaFormat(fieldSchema);
    const description = boundedText(fieldSchema?.description);
    const field: OpenApiField = {
      name: boundedText(fieldName, 160) ?? fieldName.slice(0, 160),
      ...(type ? { type } : {}),
      ...(format ? { format } : {}),
      ...(description ? { description } : {}),
      required: required.has(name),
    };
    fields.push(field);
    if (depth < 2 && fieldSchema?.type === 'object') {
      fields.push(...fieldsFromSchema(fieldSchema, field.name, depth + 1).slice(0, MAX_FIELDS - fields.length));
    }
  }
  return fields.slice(0, MAX_FIELDS);
}

function parameterFrom(value: unknown): OpenApiParameter | undefined {
  const record = asRecord(value);
  const name = boundedText(record?.name, 160);
  const location = record?.in;
  if (!name || (location !== 'path' && location !== 'query' && location !== 'header' && location !== 'cookie')) {
    return undefined;
  }
  const schema = asRecord(record?.schema);
  const type = schemaType(schema) ?? boundedText(record?.type, 80);
  const format = schemaFormat(schema);
  const description = boundedText(record?.description);
  return {
    name,
    in: location,
    required: location === 'path' || record?.required === true,
    ...(type ? { type } : {}),
    ...(format ? { format } : {}),
    ...(description ? { description } : {}),
  };
}

function parametersFrom(value: unknown): OpenApiParameter[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parameterFrom)
    .filter((parameter): parameter is OpenApiParameter => Boolean(parameter))
    .slice(0, MAX_PARAMETERS);
}

function mergeParameters(pathParameters: OpenApiParameter[], operationParameters: OpenApiParameter[]): OpenApiParameter[] {
  const merged = new Map<string, OpenApiParameter>();
  for (const parameter of [...pathParameters, ...operationParameters]) {
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...merged.values()].slice(0, MAX_PARAMETERS);
}

function requestBodyFrom(value: unknown): OpenApiRequestBody | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const content = asRecord(record.content);
  const contentTypes = Object.keys(content ?? {}).slice(0, MAX_CONTENT_TYPES);
  const firstContent = contentTypes.length ? asRecord(content?.[contentTypes[0]!]) : null;
  return {
    required: record.required === true,
    contentTypes,
    fields: fieldsFromSchema(firstContent?.schema),
  };
}

function responsesFrom(value: unknown): OpenApiResponse[] {
  const responses = asRecord(value);
  if (!responses) return [];
  return Object.entries(responses).slice(0, MAX_RESPONSES).map(([status, rawResponse]) => {
    const response = asRecord(rawResponse);
    const content = asRecord(response?.content);
    const contentTypes = Object.keys(content ?? {}).slice(0, MAX_CONTENT_TYPES);
    const firstContent = contentTypes.length ? asRecord(content?.[contentTypes[0]!]) : null;
    return {
      status: boundedText(status, 32) ?? status.slice(0, 32),
      ...(boundedText(response?.description) ? { description: boundedText(response?.description) } : {}),
      contentTypes,
      fields: fieldsFromSchema(firstContent?.schema),
    };
  });
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
    const pathParameters = parametersFrom(item.parameters);
    for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete']) {
      const operation = asRecord(item[method]);
      if (!operation) continue;
      const operationId =
        typeof operation.operationId === 'string' && operation.operationId.trim()
          ? operation.operationId.trim()
          : `${method}_${path.replace(/[^\w]+/g, '_')}`;
      if (operationIds.has(operationId)) throw new Error('openapi_operation_id_duplicate');
      operationIds.add(operationId);
      const summary = boundedText(operation.summary);
      const requestBody = requestBodyFrom(operation.requestBody);
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        ...(summary ? { summary } : {}),
        sideEffect: operationSideEffect(method, operation),
        parameters: mergeParameters(pathParameters, parametersFrom(operation.parameters)),
        ...(requestBody ? { requestBody } : {}),
        responses: responsesFrom(operation.responses),
      });
      if (operations.length > MAX_OPERATIONS) throw new Error('openapi_operations_limit');
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
