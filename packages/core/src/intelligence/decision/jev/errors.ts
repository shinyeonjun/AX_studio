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

/** Validate without trimming or otherwise changing the credential. */
export function validateJevApiKey(apiKey: string): void {
  if (!apiKey) throw new JevDecisionError('A TypeSafe API key is required.');
  if (apiKey.length > JEV_MAX_API_KEY_LENGTH || !JEV_API_KEY_PATTERN.test(apiKey)) {
    throw new JevDecisionError(
      'TypeSafe API keys must be ASCII bearer tokens with no whitespace. Re-enter the key exactly as issued.',
    );
  }
}
