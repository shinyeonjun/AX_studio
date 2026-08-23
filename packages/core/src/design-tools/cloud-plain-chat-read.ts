import { getCapability } from '../catalog/capabilities.js';
import { citationsFromSearchHits } from '../platform/citations.js';
import type { SearchHit } from '../platform/knowledge.js';
import { applySnippetPolicy } from '../retrieval/snippet-policy.js';
import type { CapabilityInvokeEnvelope } from './capability-invoke.js';

const BLOCKED_CLOUD_PLAIN_READS = new Set([
  'gmail.messages.read',
  'slack.messages.read',
  'document.ingest',
  'document.html.render',
]);

/** Without explicit untrusted-data permission, cloud plain chat stays metadata-only. */
export function allowsCloudPlainChatRead(capabilityId: string): boolean {
  const cap = getCapability(capabilityId.trim());
  if (!cap || cap.kind !== 'read') return false;
  if (BLOCKED_CLOUD_PLAIN_READS.has(cap.id)) return false;
  if (cap.connector === 'document') return false;
  return true;
}

export function sanitizeCloudReadEnvelope(envelope: CapabilityInvokeEnvelope): CapabilityInvokeEnvelope {
  const data = envelope.data;
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray((data as { hits?: unknown }).hits)
  ) {
    const hits = applySnippetPolicy((data as { hits: SearchHit[] }).hits, { allowFullContent: false });
    return {
      ...envelope,
      data: { ...(data as Record<string, unknown>), hits },
      citations: citationsFromSearchHits(hits),
      untrusted: true,
    };
  }
  return envelope;
}
