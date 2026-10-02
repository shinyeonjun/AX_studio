import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { parseHttpEndpoints } from '../../../../connectors/http/connection/parse.js';
import type { MetadataCatalog, SourceMetadataEvidence } from '../../../../contracts/request-understanding.js';
import type { ClaimedMetadataDispatch, LocalMetadataAdapterDescriptor } from '../../../decision/request-understanding/session.js';
import type { AxCommand, AxCommandResult } from '../schema.js';
import { issue, result } from '../contract.js';

const SOURCE_INPUT_LIMIT = 128;
const RESULT_BYTES = 32_768;
const complete = (knownTotal: number | null, truncated = false) => ({
  knownTotal, truncated, overflow: truncated, retrievalMethod: 'configured_registry' as const,
});

/** Reject whole references; never remove credentials/delimiters and return a different identity. */
export function isSafeRegisteredHttpOperationPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path || path.length > 512 || path !== path.trim()) return false;
  const unsafe = (view: string) => !/^[A-Za-z0-9._~!$&'()*+,;=:%/-]+$/u.test(view)
    || /[\u0000-\u0020\u007f@?#\\]/u.test(view) || view.startsWith('/') || view.includes('//')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(view) || /(?:^|\/)(?:\.{1,2})(?:\/|$)/u.test(view);
  if (unsafe(path) || /%(?:2f|5c)/iu.test(path)) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  // A remaining escape is an ambiguously nested encoding. Fail closed in one bounded pass.
  return !decoded.includes('%') && !unsafe(decoded);
}

interface LocalSource {
  id: string; label: string; aliases: string[]; enabled: boolean;
  operations?: Array<{ path: string; label: string }>;
  operationInputFiltered: boolean;
  fields?: SourceMetadataEvidence['entries'][number]['fields'];
  fieldInputFiltered: boolean;
}

function localSources(store: WorkflowStore) {
  const connection = store.getConnections({ suppressCorruptDiagnostics: true }).find(entry => entry.connector === 'http');
  const rawConfig = connection?.config;
  if (!rawConfig || connection?.configCorrupted) return { sources: [] as LocalSource[], incomplete: Boolean(connection), capped: false };
  const rawRecords = Array.isArray(rawConfig.endpoints) && rawConfig.endpoints.length > 0 ? rawConfig.endpoints : [rawConfig];
  const capped = rawRecords.length > SOURCE_INPUT_LIMIT;
  const records = rawRecords.slice(0, SOURCE_INPUT_LIMIT);
  const parsed = parseHttpEndpoints(Array.isArray(rawConfig.endpoints) && rawConfig.endpoints.length > 0
    ? { endpoints: records } : rawConfig);
  let incomplete = capped || parsed.length !== rawRecords.length;
  const sources: LocalSource[] = [];
  for (const endpoint of parsed) {
    // Source and operation identities must both fit the existing 256-character contracts.
    if (!/^[A-Za-z0-9_-]{1,233}$/u.test(endpoint.id) || (endpoint.label?.length ?? 0) > 160) { incomplete = true; continue; }
    try {
      const url = new URL(endpoint.baseUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') { incomplete = true; continue; }
    } catch { incomplete = true; continue; }
    const raw = records.find((entry, index) => entry && typeof entry === 'object' && !Array.isArray(entry)
      && (typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : index === 0 ? 'default' : `http-${index + 1}`) === endpoint.id);
    const storedOperations: unknown = raw && typeof raw === 'object' ? raw.discoveredReadOperations : undefined;
    const operations = endpoint.discoveredReadOperations?.filter(operation => isSafeRegisteredHttpOperationPath(operation.path)
      && Array.isArray(storedOperations) && storedOperations.some(entry => entry && typeof entry === 'object'
        && entry.path === operation.path && isSafeRegisteredHttpOperationPath(entry.path)));
    const operationInputFiltered = Array.isArray(storedOperations)
      ? operations?.length !== storedOperations.length : storedOperations !== undefined;
    const id = `http:${endpoint.id}`;
    const dictionary = store.getDiscoveryMetadata(id);
    let fieldInputFiltered = false;
    const fields = dictionary?.fields.map(field => {
      const type = field.type && field.type.length <= 80 ? field.type : undefined;
      if (field.type && !type) fieldInputFiltered = true;
      return { name: field.name, ...(type ? { type } : {}), ...(field.required === undefined ? {} : { required: field.required }) };
    });
    sources.push({ id, label: endpoint.label || endpoint.id, aliases: (dictionary?.aliases ?? []).slice(0, 16),
      enabled: connection?.connected === true, operations, operationInputFiltered, fields, fieldInputFiltered });
  }
  return { sources, incomplete, capped };
}

/** Synchronous counter/state pairing. No raw config, endpoint URL or credential is returned. */
export function snapshotRegisteredHttpMetadata(store: WorkflowStore, input: { catalogRevision: number; policyRevision: number }): {
  catalog: MetadataCatalog; adapter: LocalMetadataAdapterDescriptor;
} {
  const connectionRevision = store.getConnectionRevision();
  const discoveryMetadataRevision = store.getDiscoveryMetadataRevision();
  const local = localSources(store);
  const catalog: MetadataCatalog = { revision: input.catalogRevision, policyRevision: input.policyRevision,
    coverage: complete(local.capped ? null : local.sources.length, local.incomplete || local.sources.length > 32),
    sources: local.sources.slice(0, 32).map(source => ({ id: source.id, assetId: source.id, label: source.label,
      aliases: source.aliases, revision: input.catalogRevision, operationCoverage: complete(3),
      operations: (['inventory', 'schema', 'connection_status'] as const).map(intent => ({
        id: `${source.id}:${intent}`, label: `Registered HTTP ${intent}`, intent, allowed: true,
        command: { name: 'discovery.describe' as const, args: { assetId: source.id, depth: intent === 'schema' ? 'schema' as const : 'summary' as const } },
      })) })) };
  return { catalog, adapter: { kind: 'registered_http_metadata', connectionRevision, discoveryMetadataRevision } };
}

function boundedEntries(evidence: SourceMetadataEvidence, entries: SourceMetadataEvidence['entries']) {
  evidence.entries = [];
  for (const entry of entries.slice(0, 64)) {
    evidence.entries.push(entry);
    if (new TextEncoder().encode(JSON.stringify(evidence)).byteLength > RESULT_BYTES - 128) {
      evidence.entries.pop();
      break;
    }
  }
  evidence.truncated ||= evidence.entries.length !== entries.length;
  return evidence;
}

/** The service calls this before normal dispatch, using only private claimed permit authority. */
export function describeRegisteredHttpMetadata(store: WorkflowStore, command: AxCommand, claim: ClaimedMetadataDispatch): AxCommandResult {
  const adapter = claim.adapter;
  if (!adapter || adapter.kind !== 'registered_http_metadata' || command.name !== 'discovery.describe'
    || command.args.assetId !== claim.sourceId || !claim.sourceId.startsWith('http:')
    || command.args.depth !== (claim.intent === 'schema' ? 'schema' : 'summary')) {
    return result(command.name, 'forbidden', undefined, [issue('metadata_adapter_forbidden', 'Only the registered local HTTP metadata command is available.')]);
  }
  if (store.getConnectionRevision() !== adapter.connectionRevision || store.getDiscoveryMetadataRevision() !== adapter.discoveryMetadataRevision) {
    return result(command.name, 'conflict', undefined, [issue('metadata_revision_conflict', 'Local metadata changed; start a new request.')]);
  }
  const source = localSources(store).sources.find(entry => entry.id === claim.sourceId);
  if (!source) return result(command.name, 'not_found', undefined, [issue('registered_http_unavailable', 'Saved HTTP registration is unavailable.')]);
  const evidence: SourceMetadataEvidence = { sourceId: claim.sourceId, sourceRevision: claim.sourceRevision, intent: claim.intent,
    entries: [], knownTotal: 0, truncated: false, scope: 'validated_local_registration' };
  if (claim.intent === 'connection_status') {
    evidence.status = { catalogExists: true, configured: true, enabled: source.enabled,
      authentication: 'unknown', operationPermission: 'unknown', health: 'unknown' };
  } else if (claim.intent === 'inventory') {
    if (source.operations === undefined) return result(command.name, 'not_found', undefined,
      [issue('registered_http_inventory_unavailable', 'No saved registered HTTP operation inventory is available.')]);
    evidence.knownTotal = source.operations.length;
    evidence.filtered = source.operationInputFiltered;
    evidence.truncated = source.operationInputFiltered;
    boundedEntries(evidence, source.operations.map((operation, index) => ({ id: `local_entry_${index}`, label: operation.label, path: operation.path })));
  } else if (claim.intent === 'schema') {
    if (!source.fields?.length) return result(command.name, 'not_found', undefined,
      [issue('registered_http_dictionary_unavailable', 'No registered field dictionary is available for this endpoint.')]);
    evidence.scope = 'registered_field_dictionary';
    evidence.knownTotal = source.fields.length;
    evidence.filtered = source.fieldInputFiltered;
    evidence.truncated = source.fieldInputFiltered;
    boundedEntries(evidence, source.fields.map((field, index) => ({ id: `local_field_${index}`, label: field.name, fields: [field] })));
  } else {
    return result(command.name, 'forbidden', undefined, [issue('metadata_intent_forbidden', 'Only saved HTTP metadata is available.')]);
  }
  return result(command.name, 'ok', evidence);
}
