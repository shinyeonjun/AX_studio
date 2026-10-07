import type { SourceListingConnection } from '../../../connectors/types.js';
import { parseHttpEndpoints } from '../../../connectors/http/connection.js';
import {
  parseOpenApiConnectionConfig,
  parseOpenApiSpec,
  type OpenApiOperation,
} from '../../../connectors/protocols/openapi/index.js';
import { addIndexedOperation, type IndexedReadOperation } from './indexed-operation.js';
import {
  explicitSearchQuery,
  isSearchParameter,
  limitParameterHint,
  MAX_TEXT_CHARS,
  naturalLimitChoices,
  parameterValue,
  SENSITIVE_PARAMETER_NAME,
  text,
} from './request-values.js';
import type { JevReadParameterHint } from './types.js';

interface OpenApiParamResolution {
  params: Record<string, unknown>;
  parameterHints: JevReadParameterHint[];
  missingParameterPaths: string[];
}

function openApiParams(
  operation: OpenApiOperation,
  userMessage: string,
): OpenApiParamResolution | undefined {
  // Auth headers and request bodies are intentionally not guessed from chat.
  // They need an explicit typed flow so a read route cannot smuggle secrets or
  // an unbounded payload into a provider call.
  if (operation.securityRequired || operation.requestBody?.required) return undefined;

  const groups: Record<string, Record<string, unknown>> = {};
  const parameterHints: JevReadParameterHint[] = [];
  const missingParameterPaths: string[] = [];
  const groupFor = {
    path: 'pathParams',
    query: 'query',
    header: 'headers',
    cookie: 'cookies',
  } as const;
  for (const parameter of operation.parameters ?? []) {
    if (SENSITIVE_PARAMETER_NAME.test(parameter.name)) {
      if (parameter.required) return undefined;
      continue;
    }
    const group = groupFor[parameter.in];
    const path = `${group}.${parameter.name}`;
    parameterHints.push({
      path,
      ...(parameter.type ? { type: parameter.type.slice(0, 40) } : {}),
      ...(parameter.description ? { description: parameter.description.slice(0, 180) } : {}),
      required: parameter.required,
      ...((parameter.enum ?? naturalLimitChoices(parameter.name, parameter.type, userMessage))
        ? { choices: parameter.enum ?? naturalLimitChoices(parameter.name, parameter.type, userMessage) }
        : {}),
    });
    const value = parameterValue(userMessage, parameter)
      ?? (parameter.in === 'query' && isSearchParameter(parameter.name)
        ? explicitSearchQuery(userMessage)
        : undefined);
    if (value !== undefined) {
      (groups[group] ??= {})[parameter.name] = value;
    }
    if (parameter.required && value === undefined) missingParameterPaths.push(path);
  }
  return { params: groups, parameterHints, missingParameterPaths };
}

export function addOpenApiOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  const parsed = parseOpenApiConnectionConfig(connection.config);
  if (!parsed) return;
  let spec;
  try {
    spec = parseOpenApiSpec(parsed.specId, parsed.specJson, parsed.baseUrl);
  } catch {
    return;
  }
  const sourceLabel = parsed.label ?? spec.title;
  for (const operation of spec.operations) {
    if (operation.method !== 'GET' && operation.method !== 'HEAD') continue;
    if (operation.sideEffect !== 'NONE') continue;
    if (!openApiParams(operation, '')) continue;
    const summary = text(operation.summary, 180);
    const operationLabel = summary ?? operation.operationId;
    addIndexedOperation(operations, {
      capabilityId: `openapi.${spec.id}.${operation.operationId}`,
      connector: 'openapi',
      sourceLabel: sourceLabel.slice(0, 160),
      label: text(`${sourceLabel}: ${operationLabel}`, 160) ?? operationLabel,
      description: text(`${sourceLabel}: ${operation.method} ${operation.path} — ${operationLabel}`, MAX_TEXT_CHARS) ?? operation.path,
    }, (userMessage) => {
      const resolution = openApiParams(operation, userMessage);
      return resolution
        ? {
            params: resolution.params,
            parameterHints: resolution.parameterHints,
            missingParameterPaths: resolution.missingParameterPaths,
          }
        : undefined;
    });
  }
}

export function addHttpOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  for (const endpoint of parseHttpEndpoints(connection.config)) {
    if (endpoint.auth?.type !== 'none' && endpoint.authStored !== true) continue;
    const sourceLabel = text(endpoint.label, 100);
    for (const operation of endpoint.discoveredReadOperations ?? []) {
      // Only paths the connected service itself advertised become operations. A
      // `/search` collection exposes its query as a host-resolved parameter.
      const searchPath = /(?:^|\/)search$/iu.test(operation.path.replace(/[?#].*$/u, '').replace(/\/+$/u, ''));
      addIndexedOperation(operations, {
        capabilityId: 'http.request',
        connector: 'http',
        ...(sourceLabel ? { sourceLabel } : {}),
        label: text(`${sourceLabel ? `${sourceLabel}: ` : ''}${operation.label}`, 160) ?? operation.label,
        description: text(`${sourceLabel ? `${sourceLabel}: ` : ''}GET ${operation.path} — ${operation.label}`, MAX_TEXT_CHARS)
          ?? `GET ${operation.path}`,
      }, (userMessage) => {
        const query = searchPath ? explicitSearchQuery(userMessage) : undefined;
        return {
          params: {
            method: 'GET',
            path: operation.path,
            connectionId: endpoint.id,
            ...(query ? { query: { q: query } } : {}),
          },
          parameterHints: [
            ...(searchPath ? [{
              path: 'query.q',
              type: 'string',
              description: 'Search text explicitly provided by the user.',
              required: true,
            }] : []),
            limitParameterHint('query.limit', userMessage, 'Maximum number of collection items to return.'),
          ],
          ...(searchPath && !query ? { missingParameterPaths: ['query.q'] } : {}),
        };
      });
    }
  }
}
