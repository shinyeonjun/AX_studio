import {
  DiscoveryAssetIndex,
  type DiscoveryAsset,
} from '../../catalog/discovery-assets.js';
import {
  CONNECTOR_CATALOG,
  CONNECTOR_IDS,
  designCapabilities,
  isConnectorAlwaysOn,
} from '../../catalog/index.js';
import { parseHttpEndpoints } from '../../connectors/http/connection.js';
import { parseLocalFolderConnectionConfig } from '../../platform/local-folder-config.js';
import { formatRdbTableRef, parseRdbTableRef } from '../../connectors/rdb/client.js';
import { parseOpenApiConnectionConfig, parseOpenApiSpec } from '../../connectors/protocols/openapi/index.js';
import type { ConnectionRecord, DesignToolContext } from './types.js';
import type { DiscoveryMetadataRecord } from '../../contracts/discovery-metadata.js';

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function connectionFor(ctx: DesignToolContext, connector: string): ConnectionRecord | undefined {
  return ctx.connections.find((entry) => entry.connector === connector);
}

function availabilityForConnector(ctx: DesignToolContext, connector: string): DiscoveryAsset['availability'] {
  if (isConnectorAlwaysOn(connector) || ctx.connectedConnectorIds.includes(connector)) return 'ready';
  return 'requires_connection';
}

function safeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid base URL]';
  }
}

function addUnique(assets: DiscoveryAsset[], seen: Set<string>, asset: DiscoveryAsset): void {
  if (seen.has(asset.id)) return;
  seen.add(asset.id);
  assets.push(asset);
}

function lineageForConnector(connector: string) {
  return [{ relationship: 'provided_by' as const, assetId: `connector:${connector}` }];
}

function openApiSpecIdForCapability(ctx: DesignToolContext, capabilityId: string): string | undefined {
  const connection = connectionFor(ctx, 'openapi');
  const parsed = parseOpenApiConnectionConfig(connection?.config);
  if (!parsed) return undefined;
  return capabilityId.startsWith(`openapi.${parsed.specId}.`) ? parsed.specId : undefined;
}

function connectorAssets(ctx: DesignToolContext, assets: DiscoveryAsset[], seen: Set<string>): void {
  const connections = new Map(ctx.connections.map((entry) => [entry.connector, entry]));
  for (const id of CONNECTOR_IDS) {
    const catalog = CONNECTOR_CATALOG[id];
    const connection = connections.get(id);
    addUnique(assets, seen, {
      id: `connector:${id}`,
      kind: 'connector',
      name: id,
      label: catalog.label,
      description: catalog.description,
      connector: id,
      aliases: [catalog.label, id],
      availability: availabilityForConnector(ctx, id),
      access: 'none',
      metadata: {
        connectable: catalog.connectable,
        alwaysOn: isConnectorAlwaysOn(id),
        connectionKind: catalog.connectionKind,
        configured: Boolean(connection),
      },
      provenance: { source: 'catalog', ref: 'connector-catalog' },
    });
  }
}

function capabilityAssets(ctx: DesignToolContext, assets: DiscoveryAsset[], seen: Set<string>): void {
  for (const capability of designCapabilities()) {
    const specId = openApiSpecIdForCapability(ctx, capability.id);
    addUnique(assets, seen, {
      id: `tool:${capability.id}`,
      kind: 'tool',
      name: capability.id,
      label: capability.label,
      description: capability.description,
      connector: capability.connector,
      aliases: [capability.id, capability.label, capability.connector],
      availability: availabilityForConnector(ctx, capability.connector),
      access: capability.kind,
      metadata: {
        capabilityId: capability.id,
        capabilityKind: capability.kind,
        sideEffect: capability.sideEffect ?? 'NONE',
        ...(specId ? { specId } : {}),
      },
      provenance: specId
        ? { source: 'openapi', ref: `openapi:${specId}` }
        : { source: 'capability', ref: `capability:${capability.id}` },
      lineage: [
        ...lineageForConnector(capability.connector),
        ...(specId ? [{ relationship: 'derived_from' as const, assetId: `openapi:${specId}` }] : []),
      ],
    });
  }
}

function rdbTableAssets(ctx: DesignToolContext, assets: DiscoveryAsset[], seen: Set<string>): void {
  const connection = connectionFor(ctx, 'rdb');
  if (!connection?.connected) return;
  const config = recordOf(connection.config);
  const database = typeof config?.type === 'string' ? config.type : 'rdb';
  const allowedTables = Array.isArray(config?.allowedTables)
    ? config.allowedTables.filter((value): value is string => typeof value === 'string')
    : [];

  for (const rawTable of allowedTables) {
    const ref = parseRdbTableRef(rawTable);
    if (!ref) continue;
    const table = formatRdbTableRef(ref);
    addUnique(assets, seen, {
      id: `rdb:${table}`,
      kind: 'database_table',
      name: table,
      label: table,
      description: `${database} 읽기 허용 테이블`,
      connector: 'rdb',
      aliases: [table, ref.table, 'DB', database],
      availability: 'ready',
      access: 'read',
      metadata: {
        table,
        ...(ref.schema ? { schema: ref.schema } : {}),
        database,
      },
      provenance: { source: 'connection', ref: 'connection:rdb' },
      lineage: lineageForConnector('rdb'),
    });
  }
}

function httpEndpointAssets(ctx: DesignToolContext, assets: DiscoveryAsset[], seen: Set<string>): void {
  const connection = connectionFor(ctx, 'http');
  if (!connection?.connected) return;
  for (const endpoint of parseHttpEndpoints(connection.config)) {
    const authType = endpoint.auth?.type ?? 'none';
    const authReady = authType === 'none' || endpoint.authStored === true;
    addUnique(assets, seen, {
      id: `http:${endpoint.id}`,
      kind: 'http_endpoint',
      name: endpoint.id,
      label: endpoint.label ?? endpoint.id,
      description: `REST API 연결 (${safeBaseUrl(endpoint.baseUrl)})`,
      connector: 'http',
      aliases: [endpoint.id, endpoint.label ?? '', safeBaseUrl(endpoint.baseUrl), 'REST', 'API'],
      availability: authReady ? 'ready' : 'blocked',
      access: 'read',
      metadata: {
        endpointId: endpoint.id,
        baseUrl: safeBaseUrl(endpoint.baseUrl),
        authType,
        authReady,
      },
      provenance: { source: 'connection', ref: 'connection:http' },
      lineage: lineageForConnector('http'),
    });
  }
}

function openApiAssets(ctx: DesignToolContext, assets: DiscoveryAsset[], seen: Set<string>): void {
  const connection = connectionFor(ctx, 'openapi');
  if (!connection?.connected) return;
  const parsed = parseOpenApiConnectionConfig(connection.config);
  if (!parsed) return;

  try {
    const spec = parseOpenApiSpec(parsed.specId, parsed.specJson);
    const hasRead = spec.operations.some((operation) => operation.sideEffect === 'NONE' || operation.sideEffect === 'REVERSIBLE');
    const hasWrite = spec.operations.some((operation) => operation.sideEffect === 'EXTERNAL' || operation.sideEffect === 'EXTERNAL_HIGH');
    addUnique(assets, seen, {
      id: `openapi:${spec.id}`,
      kind: 'http_endpoint',
      name: spec.id,
      label: parsed.label ?? spec.title,
      description: `${spec.title} OpenAPI REST API (${safeBaseUrl(spec.baseUrl)})`,
      connector: 'openapi',
      aliases: [spec.id, parsed.label ?? '', spec.title, 'REST', 'API'],
      availability: 'ready',
      access: hasRead && hasWrite ? 'mixed' : hasWrite ? 'write' : hasRead ? 'read' : 'none',
      metadata: {
        specId: spec.id,
        title: spec.title,
        baseUrl: safeBaseUrl(spec.baseUrl),
        operationCount: spec.operations.length,
      },
      provenance: { source: 'openapi', ref: `openapi:${spec.id}` },
      lineage: lineageForConnector('openapi'),
    });
  } catch {
    // A persisted connection can outlive a malformed or incompatible spec.
    // Keep the asset discoverable as blocked without leaking parser details.
    const specId = parsed.specId;
    addUnique(assets, seen, {
      id: `openapi:${specId}`,
      kind: 'http_endpoint',
      name: specId,
      label: parsed.label ?? specId,
      description: 'OpenAPI 사양을 읽을 수 없는 REST API',
      connector: 'openapi',
      aliases: [specId, parsed.label ?? '', 'REST', 'API'],
      availability: 'blocked',
      access: 'none',
      metadata: { specId, specValid: false },
      provenance: { source: 'connection', ref: 'connection:openapi' },
      lineage: lineageForConnector('openapi'),
    });
  }
}

function folderAssets(ctx: DesignToolContext, assets: DiscoveryAsset[], seen: Set<string>): void {
  const connection = connectionFor(ctx, 'local_folder');
  if (!connection?.connected) return;
  const folders = parseLocalFolderConnectionConfig(connection.config)?.folders ?? [];
  for (const folder of folders) {
    addUnique(assets, seen, {
      id: `folder:${folder.id}`,
      kind: 'folder',
      name: folder.id,
      label: folder.label,
      description: '연결된 로컬 폴더 자료',
      connector: 'local_folder',
      aliases: [folder.id, folder.label, '폴더', '자료'],
      availability: 'ready',
      access: 'read',
      metadata: { folderId: folder.id },
      provenance: { source: 'connection', ref: 'connection:local_folder' },
      lineage: lineageForConnector('local_folder'),
    });
  }
}

function applyMetadata(asset: DiscoveryAsset, entries: ReadonlyMap<string, DiscoveryMetadataRecord>): DiscoveryAsset {
  const metadata = entries.get(asset.id);
  if (!metadata) return asset;
  return {
    ...asset,
    ...(metadata.description ? { description: metadata.description } : {}),
    aliases: [...new Set([...asset.aliases, ...metadata.aliases])],
    ...(metadata.fields.length ? { fields: metadata.fields } : {}),
  };
}

/**
 * Builds the compact, safe catalog used by discovery commands.
 * Connector-specific parsing stays here as an adapter; the ranking/index
 * implementation remains neutral and easy to replace or test.
 */
export function buildDiscoveryAssetIndex(ctx: DesignToolContext): DiscoveryAssetIndex {
  const assets: DiscoveryAsset[] = [];
  const seen = new Set<string>();
  connectorAssets(ctx, assets, seen);
  openApiAssets(ctx, assets, seen);
  capabilityAssets(ctx, assets, seen);
  rdbTableAssets(ctx, assets, seen);
  httpEndpointAssets(ctx, assets, seen);
  folderAssets(ctx, assets, seen);
  const metadata = new Map(ctx.discoveryMetadata?.map(entry => [entry.assetId, entry]));
  return new DiscoveryAssetIndex(assets.map((asset) => applyMetadata(asset, metadata)));
}
