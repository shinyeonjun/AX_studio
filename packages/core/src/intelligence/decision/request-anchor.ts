import { createHash } from 'node:crypto';
import type { DecisionEngine, DecisionEvaluationRequest } from '../../contracts/decision.js';
import {
  AuthoritativeRequestAnchorSchema,
  type AuthoritativeRequestAnchor,
  type AuthoritativeRequestBudget,
  type AuthoritativeRequestFailure,
} from '../../contracts/request-anchor.js';

/** Input policy only. This does not increase the Jev adapter's 64 KiB wire limit. */
export const DEFAULT_AUTHORITATIVE_REQUEST_BUDGET: Readonly<AuthoritativeRequestBudget> = Object.freeze({
  maxUtf8Bytes: 8_192,
  maxSerializedUtf8Bytes: 16_384,
  // Preserve existing multi-batch catalogs, with a separate finite host-packet ceiling.
  maxDecisionPacketUtf8Bytes: 1_048_576,
});

export class AuthoritativeRequestError extends Error {
  readonly providerRequestCount = 0;
  readonly requestBytes = 0;

  constructor(readonly failure: AuthoritativeRequestFailure) {
    super(failure.code);
    this.name = 'AuthoritativeRequestError';
  }
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const invalidText = (text: string) => !text.trim()
  || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
const digest = (text: string) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

export function authoritativeRequestBudget(
  overrides?: Partial<AuthoritativeRequestBudget>,
): Readonly<AuthoritativeRequestBudget> {
  const budget = { ...DEFAULT_AUTHORITATIVE_REQUEST_BUDGET, ...overrides };
  if (Object.values(budget).some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new AuthoritativeRequestError({ code: 'invalid_request_budget' });
  }
  return Object.freeze(budget);
}

type RequestOrigin = Pick<AuthoritativeRequestAnchor,
  'originalRequestId' | 'workspaceSessionId' | 'catalogRevision'>;

export function createAuthoritativeRequestAnchor(
  text: string,
  origin: RequestOrigin = {},
  overrides?: Partial<AuthoritativeRequestBudget>,
): AuthoritativeRequestAnchor {
  const budget = authoritativeRequestBudget(overrides);
  // Lone UTF-16 surrogates would be replaced on the wire and can alias in a digest.
  if (typeof text !== 'string' || invalidText(text)) {
    throw new AuthoritativeRequestError({ code: 'invalid_request_text' });
  }
  const bytes = utf8Bytes(text);
  if (bytes > budget.maxUtf8Bytes) {
    throw new AuthoritativeRequestError({ code: 'request_utf8_budget_exceeded', actualBytes: bytes, maxBytes: budget.maxUtf8Bytes });
  }
  const serializedBytes = utf8Bytes(JSON.stringify({ request: text }));
  if (serializedBytes > budget.maxSerializedUtf8Bytes) {
    throw new AuthoritativeRequestError({ code: 'request_serialized_budget_exceeded', actualBytes: serializedBytes, maxBytes: budget.maxSerializedUtf8Bytes });
  }
  const anchor = AuthoritativeRequestAnchorSchema.safeParse({ version: 1, text, digest: digest(text), utf8Bytes: bytes,
    serializedUtf8Bytes: serializedBytes, decisionTextComplete: true,
    ...(origin.originalRequestId === undefined ? {} : { originalRequestId: origin.originalRequestId }),
    ...(origin.workspaceSessionId === undefined ? {} : { workspaceSessionId: origin.workspaceSessionId }),
    ...(origin.catalogRevision === undefined ? {} : { catalogRevision: origin.catalogRevision }),
  });
  if (!anchor.success) throw new AuthoritativeRequestError({ code: 'request_anchor_mismatch' });
  return Object.freeze(anchor.data);
}

/** Verify versioned snapshots without claiming that a legacy prefix is complete. */
export function verifyAuthoritativeRequestAnchor(value: unknown): AuthoritativeRequestAnchor {
  const parsed = AuthoritativeRequestAnchorSchema.safeParse(value);
  if (!parsed.success || invalidText(parsed.data.text) || parsed.data.digest !== digest(parsed.data.text)
    || parsed.data.utf8Bytes !== utf8Bytes(parsed.data.text)
    || parsed.data.serializedUtf8Bytes !== utf8Bytes(JSON.stringify({ request: parsed.data.text }))) {
    throw new AuthoritativeRequestError({ code: 'request_anchor_mismatch' });
  }
  return Object.freeze(parsed.data);
}

export function resolveAuthoritativeRequestAnchor(
  text: string,
  held?: AuthoritativeRequestAnchor,
  origin: RequestOrigin = {},
  overrides?: Partial<AuthoritativeRequestBudget>,
): AuthoritativeRequestAnchor {
  const accepted = createAuthoritativeRequestAnchor(text, origin, overrides);
  if (!held) return accepted;
  const original = verifyAuthoritativeRequestAnchor(held);
  if (original.text !== accepted.text || original.digest !== accepted.digest
    || (origin.workspaceSessionId !== undefined && original.workspaceSessionId !== origin.workspaceSessionId)) {
    throw new AuthoritativeRequestError({ code: 'request_anchor_mismatch' });
  }
  return original;
}

/** The exact request is supplied once at the root, with non-text provenance beside it. */
export function authoritativeDecisionRequest(
  request: DecisionEvaluationRequest,
  anchor: AuthoritativeRequestAnchor,
  overrides?: Partial<AuthoritativeRequestBudget>,
): DecisionEvaluationRequest {
  const budget = authoritativeRequestBudget(overrides);
  anchor = resolveAuthoritativeRequestAnchor(anchor.text, anchor, {}, budget);
  const { text: _text, ...provenance } = anchor;
  const state = request.state && typeof request.state === 'object' && !Array.isArray(request.state)
    ? request.state as Record<string, unknown>
    : { context: request.state };
  const guarded = { ...request, state: { ...state, request: anchor.text, request_anchor: provenance } };
  let bytes: number;
  try {
    bytes = utf8Bytes(JSON.stringify({ state: guarded.state, questions: guarded.questions }));
  } catch {
    throw new AuthoritativeRequestError({ code: 'decision_packet_not_serializable' });
  }
  if (bytes > budget.maxDecisionPacketUtf8Bytes) {
    throw new AuthoritativeRequestError({ code: 'decision_packet_budget_exceeded', actualBytes: bytes, maxBytes: budget.maxDecisionPacketUtf8Bytes });
  }
  return guarded;
}

const guardedEngines = new WeakMap<DecisionEngine, DecisionEngine>();

export function guardAuthoritativeRequestDecisions(
  engine: DecisionEngine,
  anchor: AuthoritativeRequestAnchor,
  overrides?: Partial<AuthoritativeRequestBudget>,
): DecisionEngine {
  const budget = authoritativeRequestBudget(overrides);
  const base = guardedEngines.get(engine) ?? engine;
  const guarded: DecisionEngine = {
    ...(base.dataHandling ? { dataHandling: base.dataHandling } : {}),
    evaluate: async (request) => {
      request.signal?.throwIfAborted();
      const result = await base.evaluate(authoritativeDecisionRequest(request, anchor, budget));
      request.signal?.throwIfAborted();
      return result;
    },
  };
  guardedEngines.set(guarded, base);
  return guarded;
}

export function authoritativeRequestClarification(failure: AuthoritativeRequestFailure): string {
  return failure.code === 'request_utf8_budget_exceeded' || failure.code === 'request_serialized_budget_exceeded'
    ? '현재 요청이 너무 길어 판단 입력 한도를 초과했습니다. 작업을 시작하지 않았습니다. 대상·기간·금지 사항을 모두 포함해 요청을 더 짧게 보내 주세요.'
    : failure.code === 'decision_packet_budget_exceeded'
      ? '요청 원문과 도구 정보를 함께 판단 입력 한도 안에 담을 수 없어 작업을 중단했습니다. 사용할 연결이나 작업 범위를 좁혀 주세요.'
      : '요청 원문을 온전히 확인하지 못해 작업을 시작하지 않았습니다. 원래 요청부터 다시 보내 주세요.';
}
