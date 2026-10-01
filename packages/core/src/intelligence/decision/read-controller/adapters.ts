import { immutableCopy, ReadControlError } from './immutable.js';
import type { ReadRegistry } from './registry.js';
import type { DecisionView, JsonValue, ObservedRefDescriptor, ReadOperation, ReadSuccess, RefHandle, SourceScope } from './types.js';

const isString = (value: JsonValue) => typeof value === 'string' && value.length > 0;
const isLimit = (value: JsonValue) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 50;

/** Thin specifications only. No connector client, service, IO, SQL or network here. */
export const GMAIL_SEARCH_READ: ReadOperation = {
  operationId: 'gmail.messages.search', connector: 'gmail', kind: 'read', sideEffect: 'NONE', purpose: 'inspect', backend: 'connector',
  label: 'Gmail search page', description: 'One metadata page. Select returned email refs for separately authorized body reads. Provider totals are estimates; terminal continuation pages retain partial upstream metadata.',
  coverage: 'metadata', pagingParameter: 'pageToken', outputRefKinds: ['EmailMessageRef', 'paging-token'],
  parameters: {
    query: { type: 'string', required: true, validate: isString, refKinds: ['request-span'], requireObservedRef: true },
    limit: { type: 'integer', validate: isLimit },
    includeMetadata: { type: 'boolean', validate: (value) => typeof value === 'boolean' },
    pageToken: { type: 'string', validate: (value) => isString(value) && (value as string).length <= 4096, refKinds: ['paging-token'], requireObservedRef: true },
  },
};

export const GMAIL_BODY_READ: ReadOperation = {
  operationId: 'gmail.messages.read', connector: 'gmail', kind: 'read', sideEffect: 'NONE', purpose: 'inspect', backend: 'connector',
  label: 'Gmail body', description: 'Read the exact selected observed EmailMessageRef. Requires current body-read policy authorization.', coverage: 'body',
  parameters: { message: { type: 'EmailMessageRef', required: true, refKinds: ['EmailMessageRef'], requireObservedRef: true,
    validate: (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.connector === 'gmail' && typeof value.id === 'string' && value.id.length > 0 } },
};

/** Existing Slack cursor-search contract only; page-number fallback is refused. */
export const SLACK_CURSOR_SEARCH_READ: ReadOperation = {
  operationId: 'slack.messages.search', connector: 'slack', kind: 'read', sideEffect: 'NONE', purpose: 'inspect', backend: 'connector',
  label: 'Slack cursor search', description: 'One cursor-based search page. Empty filtered pages may have a next cursor. No exact-total or stable full-query snapshot guarantee.',
  coverage: 'rows', pagingParameter: 'cursor', outputRefKinds: ['paging-token'],
  parameters: {
    query: { type: 'string', required: true, validate: isString, refKinds: ['request-span'], requireObservedRef: true },
    limit: { type: 'integer', validate: isLimit },
    cursor: { type: 'string', validate: (value) => isString(value) && (value as string).length <= 4096, refKinds: ['paging-token'], requireObservedRef: true },
  },
};

export function offerSearchSpan(registry: ReadRegistry, source: SourceScope, operationId: string,
  query: RefHandle, coverageKey: string, limit = 20): string {
  return registry.offer({ operationId, source, coverageKey, label: `${source.connector} exact query span`,
    bindings: { query: { origin: 'observed-ref', ref: query }, limit: { origin: 'host-fixed', value: limit },
      ...(source.connector === 'gmail' ? { includeMetadata: { origin: 'host-fixed' as const, value: true } } : {}) } });
}

export function offerGmailBody(registry: ReadRegistry, source: SourceScope, ref: ObservedRefDescriptor, coverageKey: string): string {
  return registry.offer({ operationId: GMAIL_BODY_READ.operationId, source, coverageKey, label: ref.label,
    bindings: { message: { origin: 'observed-ref', ref: { refId: ref.refId, snapshotDigest: ref.snapshotDigest } } } });
}

function object(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadControlError('invalid_connector_page');
  return value;
}

/** Normalizers accept the existing JSON envelope, not a raw SDK/prototype object. */
export function normalizeGmailSearchPage(data: JsonValue, decisionView: DecisionView): ReadSuccess {
  const page = object(data);
  if (!Array.isArray(page.hits) || !Array.isArray(page.messages) || typeof page.truncated !== 'boolean') {
    throw new ReadControlError('invalid_gmail_page');
  }
  const references = page.hits.map((hit, index) => {
    const ref = object(object(hit).ref!);
    if (ref.connector !== 'gmail' || ref.kind !== 'email' || typeof ref.id !== 'string' || !ref.id) {
      throw new ReadControlError('invalid_gmail_hit');
    }
    return { key: `message:${index}`, kind: 'EmailMessageRef' as const, label: `Gmail search hit ${index + 1}`,
      value: ref, extraction: `hits[${index}].ref` };
  });
  const next = page.nextPageToken;
  if (page.truncated !== (typeof next === 'string' && next.length > 0)) throw new ReadControlError('invalid_atomic_pagination');
  const allRefs = [...references, ...(typeof next === 'string' ? [{ key: 'next', kind: 'paging-token' as const,
    label: 'Gmail next page', value: next, extraction: 'nextPageToken' }] : [])];
  return immutableCopy({ status: 'ok', data, decisionView,
    upstream: page.completeness as ReadSuccess['upstream'], references: allRefs,
    pagination: { hasMore: page.truncated, ...(page.truncated ? { nextRefKey: 'next' } : {}) },
    ...(typeof page.total === 'number' ? { total: { value: page.total, isEstimate: true } } : {}) });
}

export function normalizeGmailBody(data: JsonValue, decisionView: DecisionView): ReadSuccess {
  const body = object(data);
  if (typeof body.id !== 'string' || typeof body.body !== 'string') throw new ReadControlError('invalid_gmail_body');
  return immutableCopy({ status: 'ok', data, decisionView, upstream: { status: 'complete', hasMore: false, observedCount: 1 } });
}

export function normalizeSlackCursorSearchPage(data: JsonValue, decisionView: DecisionView): ReadSuccess {
  const page = object(data);
  if (!Array.isArray(page.matches) || typeof page.truncated !== 'boolean') throw new ReadControlError('invalid_slack_page');
  // Do not silently reinterpret a provider's page fallback as a cursor or
  // declare a provider page-limit terminal result complete.
  if (page.nextPage !== undefined || page.paginationLimitReached === true) throw new ReadControlError('slack_page_mode_not_supported');
  const next = page.nextCursor;
  if (page.truncated !== (typeof next === 'string' && next.length > 0)) throw new ReadControlError('invalid_atomic_pagination');
  return immutableCopy({ status: 'ok', data, decisionView, upstream: page.completeness as ReadSuccess['upstream'],
    references: typeof next === 'string' ? [{ key: 'next', kind: 'paging-token', label: 'Slack next page', value: next, extraction: 'nextCursor' }] : [],
    pagination: { hasMore: page.truncated, ...(page.truncated ? { nextRefKey: 'next' } : {}) },
    ...(typeof page.total === 'number' ? { total: { value: page.total, isEstimate: false } } : {}) });
}
