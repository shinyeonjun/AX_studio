import { getCapability } from '../../catalog/capabilities.js';
import { capabilityActionName, readCapabilityMethodIssue } from '../../catalog/capability-graph.js';
import { isPlainChatSideEffectAllowed } from '../../platform/side-effect-policy.js';
import { citationsFromSearchHits } from '../../platform/citations.js';
import type { ConnectorContext, ConnectorFailureKind, ConnectorResult } from '../../connectors/types.js';
import { connectorFailureKind } from '../../connectors/failure-kind.js';
import { ArtifactCompletenessSchema, type ArtifactCompleteness } from '../../contracts/artifacts/completeness.js';
import type { DesignToolContext } from './types.js';

export { connectorFailureKind };

function noopLog(): void {
  // design-tool reads do not persist execution logs
}

export interface CapabilityInvokeEnvelope {
  capabilityId: string;
  data: unknown;
  citations: ReturnType<typeof citationsFromSearchHits>;
  untrusted: boolean;
  /** Describes this model view, independently of upstream source completeness. */
  evidence?: {
    /** A provider cursor advances past its full page, including omitted preview rows. */
    truncated: boolean;
    reason?: 'model_evidence_limit' | 'privacy_policy';
    upstreamCompleteness?: ArtifactCompleteness;
  };
}

const MAX_EVIDENCE_CHARS = 12_000;
const MAX_EVIDENCE_ITEMS = 50;
const MAX_EVIDENCE_STRING_CHARS = 2_000;
const MAX_EVIDENCE_DEPTH = 8;
const MAX_PAGING_METADATA_CHARS = 8_000;
const PAGING_CURSOR_KEYS = ['nextPageToken', 'nextCursor', 'nextLatest'] as const;
const PAGING_COUNT_KEYS = ['nextPage', 'nextOffset', 'page', 'pageSize', 'limit', 'total', 'totalCount', 'resultSizeEstimate', 'returnedCount'] as const;

/** Paging controls are atomic: preserve exact values or fail, never shorten a cursor. */
export function capabilityPagingMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of PAGING_CURSOR_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') throw new Error('capability_paging_metadata_invalid');
    if (typeof value === 'string' && value.length > MAX_PAGING_METADATA_CHARS) throw new Error('capability_paging_metadata_too_large');
    output[key] = value;
  }
  for (const key of PAGING_COUNT_KEYS) {
    const value = input[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) output[key] = value;
  }
  for (const key of ['hasMore', 'truncated', 'totalIsEstimate', 'paginationLimitReached']) {
    if (typeof input[key] === 'boolean') output[key] = input[key];
  }
  if (input.completeness !== undefined) {
    const parsed = ArtifactCompletenessSchema.safeParse(input.completeness);
    if (parsed.success) output.completeness = parsed.data;
  }
  if (JSON.stringify(output).length > MAX_PAGING_METADATA_CHARS) throw new Error('capability_paging_metadata_too_large');
  return output;
}

/** Copy only bounded JSON evidence. Never slice the connector's execution data. */
export function boundCapabilityEvidence(envelope: CapabilityInvokeEnvelope): CapabilityInvokeEnvelope {
  let remaining = MAX_EVIDENCE_CHARS;
  let omissions = 0;
  const ancestors = new Set<object>();
  const omit = () => { omissions += 1; return null; };
  const visit = (value: unknown, depth: number): unknown => {
    if (remaining < 8 || depth > MAX_EVIDENCE_DEPTH) return omit();
    if (typeof value === 'string') {
      let text = value.slice(0, Math.min(MAX_EVIDENCE_STRING_CHARS, remaining - 2));
      // JSON escaping can expand one source character into six output characters.
      let serialized = JSON.stringify(text);
      while (serialized.length > remaining) {
        text = text.slice(0, Math.floor(text.length / 2));
        serialized = JSON.stringify(text);
      }
      remaining -= serialized.length;
      if (text.length < value.length) omissions += 1;
      return text;
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      remaining -= JSON.stringify(value).length;
      return value;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) return omit();
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return omit();
    const before = omissions;
    ancestors.add(value);
    remaining -= 2;
    let output: unknown;
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (let i = 0; i < value.length && i < MAX_EVIDENCE_ITEMS && remaining >= 8; i += 1) {
        remaining -= 1;
        items.push(visit(value[i], depth + 1));
      }
      if (items.length < value.length) omissions += 1;
      output = items;
    } else {
      const record = value as Record<string, unknown>;
      const fields: Record<string, unknown> = Object.create(null);
      let count = 0;
      if (depth === 0) {
        const paging = capabilityPagingMetadata(record);
        Object.assign(fields, paging);
        remaining -= JSON.stringify(paging).length;
        count = Object.keys(paging).length;
      }
      for (const key in record) {
        if (!Object.hasOwn(record, key)) continue;
        if (depth === 0 && Object.hasOwn(fields, key)) continue;
        if (record[key] === undefined) continue;
        if (count >= MAX_EVIDENCE_ITEMS || remaining < 8) { omissions += 1; break; }
        if (key.length > MAX_EVIDENCE_STRING_CHARS) { omissions += 1; break; }
        const cost = JSON.stringify(key).length + 2;
        if (cost + 8 > remaining) { omissions += 1; break; }
        remaining -= cost;
        fields[key] = visit(record[key], depth + 1);
        count += 1;
      }
      if (omissions > before && (record.kind === 'table' || record.kind === 'http_response')) {
        fields.truncated = true;
        remaining -= 18;
        fields.completeness = { status: 'partial', reason: 'unknown' };
        remaining -= 80;
      }
      output = fields;
    }
    ancestors.delete(value);
    return output;
  };
  const data = visit(envelope.data, 0);
  const citations = visit(envelope.citations, 0) as CapabilityInvokeEnvelope['citations'] | null;
  const upstream = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? ArtifactCompletenessSchema.safeParse((envelope.data as Record<string, unknown>).completeness)
    : undefined;
  return {
    capabilityId: envelope.capabilityId,
    data,
    citations: citations ?? [],
    untrusted: true,
    evidence: {
      truncated: omissions > 0 || envelope.evidence?.truncated === true,
      ...(omissions > 0 ? { reason: 'model_evidence_limit' as const }
        : envelope.evidence?.reason ? { reason: envelope.evidence.reason } : {}),
      ...(upstream?.success ? { upstreamCompleteness: upstream.data } : {}),
    },
  };
}

/** Preserve connector failure metadata while crossing the design-tool boundary. */
export class CapabilityInvokeError extends Error {
  constructor(
    message: string,
    readonly errorDetails?: unknown,
    readonly failureKind: ConnectorFailureKind = 'unknown',
  ) {
    super(message);
    this.name = 'CapabilityInvokeError';
  }
}

export async function invokeReadCapability(
  ctx: DesignToolContext,
  capabilityId: string,
  params: Record<string, unknown>,
): Promise<CapabilityInvokeEnvelope> {
  ctx.abortSignal?.throwIfAborted();
  const id = capabilityId.trim();
  if (!id) throw new Error('capability_id_required');

  const cap = getCapability(id);
  if (!cap) throw new Error('capability_not_found');
  if (cap.kind !== 'read') throw new Error('capability_not_readable');

  const methodIssue = readCapabilityMethodIssue(cap, params);
  if (methodIssue) throw new Error(methodIssue);

  if (!isPlainChatSideEffectAllowed(cap.sideEffect)) {
    throw new Error('capability_not_allowed_in_plain_chat');
  }

  if (!ctx.connectedConnectorIds.includes(cap.connector)) {
    throw new Error('connector_not_connected');
  }

  const connector = ctx.connectors?.[cap.connector];
  if (!connector) throw new Error('connector_not_available');

  const connectorCtx: ConnectorContext = {
    executionId: 'design-tool',
    variables: {},
    log: noopLog,
    abortSignal: ctx.abortSignal,
    connections: ctx.connections.map(({ connector, connected, config }) => ({
      connector,
      connected,
      ...(config && typeof config === 'object' && !Array.isArray(config)
        ? { config: config as Record<string, unknown> }
        : {}),
    })),
  };

  let result: ConnectorResult;
  try {
    result = await connector.execute(capabilityActionName(cap), params, connectorCtx);
  } catch (error) {
    ctx.abortSignal?.throwIfAborted();
    throw new CapabilityInvokeError(error instanceof Error ? error.message : String(error));
  }
  ctx.abortSignal?.throwIfAborted();
  if (!result.ok) {
    throw new CapabilityInvokeError(
      result.error ?? 'capability_invoke_failed',
      result.errorDetails,
      connectorFailureKind(result.errorCode, result.errorDetails),
    );
  }

  const data = result.data;
  const citations =
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray((data as { hits?: unknown }).hits)
      ? citationsFromSearchHits((data as { hits: import('../../platform/knowledge.js').SearchHit[] }).hits)
      : [];

  return {
    capabilityId: id,
    data,
    citations,
    untrusted: true,
  };
}
