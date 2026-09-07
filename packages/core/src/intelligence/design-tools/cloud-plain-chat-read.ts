import { getCapability } from '../../catalog/capabilities.js';
import { citationsFromSearchHits } from '../../platform/citations.js';
import type { SearchHit } from '../../platform/knowledge.js';
import { MAX_CLOUD_SNIPPET_CHARS } from '../retrieval/snippet-policy.js';
import { capabilityPagingMetadata, type CapabilityInvokeEnvelope } from './capability-invoke.js';

const METADATA_CLOUD_PLAIN_READS = new Set([
  'gmail.messages.search',
  'slack.messages.search',
  'slack.channels.list',
  'rdb.schema.describe',
  'local_folder.list',
]);

/** Without explicit untrusted-data permission, cloud plain chat stays metadata-only. */
export function allowsCloudPlainChatRead(capabilityId: string): boolean {
  const cap = getCapability(capabilityId.trim());
  return Boolean(cap && cap.kind === 'read' && METADATA_CLOUD_PLAIN_READS.has(cap.id));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_CLOUD_SNIPPET_CHARS) : undefined;
}

function metadata(value: unknown, keys: string[]): Record<string, unknown> {
  const input = record(value);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const entry = input[key];
    if (typeof entry === 'string') output[key] = text(entry);
    else if (typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))) output[key] = entry;
  }
  return output;
}

/** Project known metadata fields; arbitrary connector extensions are never copied. */
export function sanitizeCloudReadEnvelope(envelope: CapabilityInvokeEnvelope): CapabilityInvokeEnvelope {
  const input = record(envelope.data);
  let modelLimited = false;
  const items = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) return [];
    if (value.length > 50) modelLimited = true;
    return value.slice(0, 50);
  };
  let data: unknown = null;
  let hits: SearchHit[] = [];
  const id = envelope.capabilityId;
  if (id === 'gmail.messages.search' || id === 'slack.messages.search') {
    hits = items(input.hits).flatMap((value): SearchHit[] => {
      const hit = record(value);
      const ref = record(hit.ref);
      if (typeof ref.id !== 'string' || !ref.id) return [];
      return [{
        ref: {
          connector: id === 'gmail.messages.search' ? 'gmail' : 'slack',
          kind: id === 'gmail.messages.search' ? 'email' : 'message',
          id: ref.id,
          label: text(ref.label),
        },
        score: typeof hit.score === 'number' && Number.isFinite(hit.score) ? hit.score : 0,
        snippet: text(hit.snippet),
      }];
    });
    const messages = id === 'gmail.messages.search'
      ? Array.isArray(envelope.data) ? envelope.data : Array.isArray(input.messages) ? input.messages : undefined
      : undefined;
    data = {
      hits,
      ...(messages ? { messages: items(messages).map((value) => metadata(value, ['id', 'threadId'])) } : {}),
    };
  } else if (id === 'slack.channels.list') {
    data = { channels: items(input.channels)
      .map((value) => metadata(value, ['id', 'name', 'isPrivate', 'numMembers'])) };
  } else if (id === 'rdb.schema.describe') {
    data = items(envelope.data)
      .filter((value): value is string => typeof value === 'string');
  } else if (id === 'local_folder.list') {
    data = {
      folder: metadata(input.folder, ['id', 'label']),
      files: items(input.files)
        .map((value) => metadata(value, ['name', 'fileName', 'extension', 'size', 'mtimeMs'])),
    };
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    data = { ...capabilityPagingMetadata(input), ...data };
  }
  return {
    capabilityId: id,
    data,
    citations: citationsFromSearchHits(hits),
    untrusted: true,
    evidence: { truncated: true, reason: modelLimited ? 'model_evidence_limit' : 'privacy_policy' },
  };
}
