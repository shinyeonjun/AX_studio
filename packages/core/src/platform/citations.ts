import type { Citation, SearchHit, SourceRef } from './knowledge.js';

export function citationFromSourceRef(ref: SourceRef, excerpt?: string): Citation {
  return {
    ref,
    excerpt,
    retrievedAt: new Date().toISOString(),
  };
}

export function citationsFromSearchHits(hits: SearchHit[]): Citation[] {
  return hits.map((hit) => citationFromSourceRef(hit.ref, hit.snippet));
}

export function slackMessageRef(channelId: string, ts: string, label?: string): SourceRef {
  return {
    connector: 'slack',
    kind: 'message',
    id: `${channelId}:${ts}`,
    label: label ?? `Slack ${ts}`,
  };
}
