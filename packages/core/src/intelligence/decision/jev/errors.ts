const JEV_MAX_API_KEY_LENGTH = 8_192;
const JEV_API_KEY_PATTERN = /^[A-Za-z0-9._~+\/-]+=*$/u;

export class JevDecisionError extends Error {
  readonly status?: number;
  readonly providerRequestCount?: number;
  readonly requestBytes?: number;
  /** Host-parser provenance. Only a valid, empty answer map for a sole question qualifies. */
  readonly failure?: Readonly<{ kind: 'missing_answer'; questionRef: string }>;

  constructor(message: string, status?: number, providerRequestCount?: number, cause?: unknown, requestBytes?: number,
    failure?: { kind: 'missing_answer'; questionRef: string }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'JevDecisionError';
    this.status = status;
    this.providerRequestCount = providerRequestCount;
    this.requestBytes = requestBytes;
    this.failure = failure && Object.freeze({ ...failure });
  }
}

/**
 * Why the decision service failed, in the terms a person can act on: the server was busy or
 * briefly down (already retried; nothing to change), it rejected the key, or it could not be
 * reached at all. Undefined when the failure is none of these.
 */
export type DecisionServiceFailure = 'busy' | 'key_rejected' | 'unreachable';

export function decisionServiceFailure(error: unknown): DecisionServiceFailure | undefined {
  for (let current = error, depth = 0; current && depth < 5; current = (current as { cause?: unknown }).cause, depth += 1) {
    if (current instanceof JevDecisionError && current.status !== undefined) {
      if (current.status === 401 || current.status === 403) return 'key_rejected';
      if (current.status === 429 || current.status >= 500) return 'busy';
      return undefined;
    }
    if (current instanceof TypeError || (current as { name?: unknown }).name === 'TimeoutError') return 'unreachable';
  }
  return undefined;
}

/** Validate without trimming or otherwise changing the credential. */
export function validateJevApiKey(apiKey: string): void {
  if (!apiKey) throw new JevDecisionError('A TypeSafe API key is required.');
  if (apiKey.length > JEV_MAX_API_KEY_LENGTH || !JEV_API_KEY_PATTERN.test(apiKey)) {
    throw new JevDecisionError(
      'TypeSafe API keys must be ASCII bearer tokens with no whitespace. Re-enter the key exactly as issued.',
    );
  }
}
