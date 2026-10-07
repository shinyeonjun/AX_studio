/** Pointer to a resource the user or connector can resolve. */
export interface SourceRef {
  connector: string;
  kind: 'email' | 'message' | 'file' | 'row' | 'http' | 'webhook_payload' | 'other';
  id: string;
  label?: string;
  path?: string;
}

/** Ranked hit before bounded read. */
/**
 * Where a search capability puts its citations (`SearchHit[]`) next to its data: Gmail and Slack
 * search return `messages`/`matches` to show and `hits` to cite. Hits are never the data table.
 */
export const SEARCH_HITS_FIELD = 'hits';

export interface SearchHit {
  ref: SourceRef;
  score: number;
  snippet?: string;
}

/** User-visible provenance attached to an answer. */
export interface Citation {
  ref: SourceRef;
  excerpt?: string;
  retrievedAt: string;
}

/** Bounded materialized view of a resource for model context. */
export interface ResourceSnapshot {
  ref: SourceRef;
  capturedAt: string;
  contentType?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

/** Local index row (Phase 6+). */
export interface IndexDocument {
  ref: SourceRef;
  indexedAt: string;
  staleAfter?: string;
  embeddingId?: string;
}
