import {
  DISCOVERY_ASSET_KINDS,
  getCapability,
  designCapabilities,
  type DiscoveryAsset,
  type DiscoveryAssetKind,
} from '../../../catalog/index.js';
import type { DiscoveryFieldMetadata } from '../../../contracts/discovery-metadata.js';
import { buildDiscoveryAssetIndex, openApiSnapshotFor } from '../discovery-catalog.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';
import { safeHttpBaseUrl } from '../../../connectors/http/request.js';

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}_required`);
  return value.trim();
}

function depthArg(args: Record<string, unknown>): 'summary' | 'schema' {
  const value = args.depth;
  if (value === undefined) return 'summary';
  if (value === 'summary' || value === 'schema') return value;
  throw new Error('depth_invalid');
}

function noopLog(): void {
  // Discovery schema reads are read-only and do not create an execution log.
}

function discoveryKind(value: unknown): DiscoveryAssetKind | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return (DISCOVERY_ASSET_KINDS as readonly string[]).includes(value.trim())
    ? value.trim() as DiscoveryAssetKind
    : undefined;
}

function pageArgs(args: Record<string, unknown>): { offset: number; limit: number } {
  const offset = args.offset === undefined ? 0 : Number(args.offset);
  const limit = args.limit === undefined ? 8 : Number(args.limit);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset_invalid');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit_invalid');
  return { offset, limit };
}

function describeCapability(asset: DiscoveryAsset, depth: 'summary' | 'schema') {
  const capabilityId = asset?.metadata.capabilityId;
  const capability = typeof capabilityId === 'string' ? getCapability(capabilityId) : undefined;
  if (!capability) return { available: false, reason: 'capability_not_found' };
  return {
    available: asset.availability === 'ready',
    capability: {
      id: capability.id,
      connector: capability.connector,
      kind: capability.kind,
      label: capability.label,
      description: capability.description,
      sideEffect: capability.sideEffect ?? 'NONE',
      ...(depth === 'schema' ? { params: capability.params, io: capability.io ?? { inputs: {}, outputs: {} } } : {}),
      connected: asset.availability === 'ready',
    },
  };
}

async function describeRdbTable(ctx: DesignToolContext, asset: DiscoveryAsset, page: { offset: number; limit: number }) {
  const table = asset.metadata.table;
  const connector = ctx.connectors?.rdb;
  if (typeof table !== 'string') return { available: false, reason: 'table_reference_missing' };
  if (!connector) return { available: false, reason: 'rdb_connector_unavailable', table };

  const result = await connector.execute('table.describe', { table, ...page }, {
    executionId: 'discovery-describe',
    abortSignal: ctx.abortSignal,
    variables: {},
    log: noopLog,
  });
  if (!result.ok) {
    return { available: false, reason: result.error ?? 'rdb_table_metadata_unavailable', table };
  }
  return {
    available: true,
    table,
    schema: mergeRdbDictionary(result.data, asset.fields),
  };
}

function mergeRdbDictionary(value: unknown, fields: readonly DiscoveryFieldMetadata[] | undefined): unknown {
  if (!fields?.length || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.columns)) return value;
  const dictionary = new Map(fields.map((field) => [field.name, field]));
  return {
    ...record,
    columns: record.columns.map((column) => {
      if (!column || typeof column !== 'object' || Array.isArray(column)) return column;
      const columnRecord = column as Record<string, unknown>;
      const field = typeof columnRecord.name === 'string' ? dictionary.get(columnRecord.name) : undefined;
      return field?.description && typeof columnRecord.description !== 'string'
        ? { ...columnRecord, description: field.description }
        : column;
    }),
  };
}

function describeGenericHttpEndpoint() {
  const operations = ['http.request', 'http.post']
    .map((id) => getCapability(id))
    .filter((capability): capability is NonNullable<typeof capability> => Boolean(capability))
    .map((capability) => ({
      id: capability.id,
      label: capability.label,
      description: capability.description,
      kind: capability.kind,
      sideEffect: capability.sideEffect ?? 'NONE',
      params: capability.params,
      io: capability.io ?? { inputs: {}, outputs: {} },
    }));
  return { source: 'connector_contract', operations };
}

function describeOpenApiEndpoint(ctx: DesignToolContext, asset: DiscoveryAsset, depth: 'summary' | 'schema', page: { offset: number; limit: number }) {
  const snapshot = openApiSnapshotFor(ctx);
  const specId = asset.metadata.specId;
  if (!snapshot || typeof specId !== 'string' || snapshot.config.specId !== specId) {
    return { available: false, reason: 'openapi_spec_not_registered' };
  }
  try {
    const spec = snapshot.spec;
    if (!spec) return { available: false, reason: 'openapi_spec_invalid' };
    // Deep operation schemas are fetched one operation per page, rather than
    // multiplying field-heavy schemas by the whole API's operation count.
    const limit = depth === 'schema' ? 1 : page.limit;
    const end = page.offset + limit;
    const operations = spec.operations.slice(page.offset, end).map((operation) => ({
      id: `openapi.${spec.id}.${operation.operationId}`,
      operationId: operation.operationId,
      method: operation.method,
      path: operation.path,
      ...(operation.summary ? { summary: operation.summary } : {}),
      ...(operation.sideEffect ? { sideEffect: operation.sideEffect } : {}),
      ...(depth === 'schema' ? {
        parameters: operation.parameters ?? [],
        ...(operation.requestBody ? { requestBody: operation.requestBody } : {}),
        responses: operation.responses ?? [],
      } : {}),
    }));
    return {
      available: asset.availability === 'ready',
      api: {
        id: spec.id,
        title: spec.title,
        baseUrl: safeHttpBaseUrl(spec.baseUrl),
      },
      operations,
      totalOperations: spec.operations.length,
      truncated: spec.operations.length > end,
      ...(spec.operations.length > end ? { nextOffset: end } : {}),
    };
  } catch {
    return { available: false, reason: 'openapi_spec_invalid' };
  }
}

export const discoverySearch: DesignToolHandler = (ctx, args) => {
  const query = requiredString(args, 'query');
  if (query.length > 500) throw new Error('query_too_long');
  const rawKind = args.kind;
  const kind = discoveryKind(rawKind);
  if (rawKind !== undefined && kind === undefined) throw new Error('kind_invalid');
  const connector = typeof args.connector === 'string' && args.connector.trim() ? args.connector.trim() : undefined;
  return buildDiscoveryAssetIndex(ctx).search({ query, kind, connector, ...pageArgs(args) });
};

export const discoveryDescribe: DesignToolHandler = async (ctx, args) => {
  const assetId = requiredString(args, 'assetId');
  const depth = depthArg(args);
  const page = pageArgs(args);
  const index = buildDiscoveryAssetIndex(ctx);
  const asset = index.find(assetId);
  if (!asset) throw new Error('discovery_asset_not_found');

  let details: unknown;
  if (asset.kind === 'tool') {
    details = describeCapability(asset, depth);
  } else if (asset.kind === 'database_table' && depth === 'schema') {
    details = await describeRdbTable(ctx, asset, page);
  } else if (asset.kind === 'http_endpoint') {
    details = asset.connector === 'openapi'
      ? describeOpenApiEndpoint(ctx, asset, depth, page)
      : {
          available: asset.availability === 'ready',
          endpoint: asset.metadata,
          ...(depth === 'schema' ? { operationSchema: describeGenericHttpEndpoint() } : {}),
          next: '읽기 작업은 http.request의 명시된 상대 경로 계약을 사용하세요. 외부 변경은 실행/승인 경계에서만 처리합니다.',
        };
  } else if (asset.kind === 'folder') {
    details = {
      available: asset.availability === 'ready',
      folderId: asset.metadata.folderId,
      next: ['sources.files.list', 'sources.search'],
    };
  } else if (asset.kind === 'connector') {
    const capabilities = designCapabilities().filter((capability) => capability.connector === asset.connector);
    const end = page.offset + page.limit;
    details = {
      available: asset.availability === 'ready',
      tools: capabilities.slice(page.offset, end)
        .map((capability) => ({ id: capability.id, label: capability.label, kind: capability.kind })),
      totalTools: capabilities.length,
      truncated: capabilities.length > end,
      ...(capabilities.length > end ? { nextOffset: end } : {}),
    };
  } else {
    details = { available: asset.availability === 'ready' };
  }

  const totalFields = asset.fields?.length ?? 0;
  const fieldEnd = page.offset + page.limit;
  return {
    asset: totalFields ? { ...asset, fields: asset.fields!.slice(page.offset, fieldEnd) } : asset,
    ...(totalFields ? {
      fieldPage: {
        total: totalFields,
        truncated: fieldEnd < totalFields,
        ...(fieldEnd < totalFields ? { nextOffset: fieldEnd } : {}),
      },
    } : {}),
    depth,
    details,
  };
};
