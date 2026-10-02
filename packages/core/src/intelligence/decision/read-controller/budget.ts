import { abortable, ReadControlError } from './immutable.js';
import type { BudgetSnapshot, ProviderBudgetPolicy, ReadLimits } from './types.js';

export const DEFAULT_READ_LIMITS: Readonly<ReadLimits> = Object.freeze({
  maxReadAttempts: 8,
  maxDecisionPhases: 12,
  maxConcurrentReads: 2,
  maxRetries: 1,
  maxDecisionPacketBytes: 65_536,
  deadlineMs: 120_000,
  minimumConfidence: 0.75,
});

export function readLimits(overrides: Partial<ReadLimits> = {}): Readonly<ReadLimits> {
  const limits = { ...DEFAULT_READ_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (key === 'minimumConfidence') {
      if (!Number.isFinite(value) || value <= 0.5 || value > 1) throw new ReadControlError('invalid_read_limits');
    } else if (!Number.isSafeInteger(value) || value < (key === 'maxRetries' ? 0 : 1)) {
      throw new ReadControlError('invalid_read_limits');
    }
  }
  return Object.freeze(limits);
}

/** Shared by all evaluator batches and connector fan-out in this one task. */
export class ReadBudget {
  readonly limits: Readonly<ReadLimits>;
  readonly providerPolicy: ProviderBudgetPolicy;
  private readAttempts = 0;
  private decisionPhases = 0;
  private providerDispatches = 0;
  private providerRequestBytes = 0;

  constructor(limits: Readonly<ReadLimits>, providerPolicy: ProviderBudgetPolicy) {
    this.limits = readLimits(limits);
    this.providerPolicy = Object.freeze({ ...providerPolicy });
    if (providerPolicy.enforcement === 'dispatch-guard') {
      if (!Number.isSafeInteger(providerPolicy.maxCalls) || providerPolicy.maxCalls < 1
        || !Number.isSafeInteger(providerPolicy.maxRequestBytes) || providerPolicy.maxRequestBytes < 1) {
        throw new ReadControlError('invalid_provider_budget');
      }
    } else if (providerPolicy.enforcement !== 'external' || typeof providerPolicy.explanation !== 'string'
      || !providerPolicy.explanation.trim()) throw new ReadControlError('missing_external_provider_budget');
  }

  reserveDecision(): void {
    if (this.decisionPhases >= this.limits.maxDecisionPhases) throw new ReadControlError('decision_phase_budget_exhausted');
    this.decisionPhases++;
  }

  reserveRead(): void {
    if (this.readAttempts >= this.limits.maxReadAttempts) throw new ReadControlError('read_attempt_budget_exhausted');
    this.readAttempts++;
  }

  remainingReads(): number { return this.limits.maxReadAttempts - this.readAttempts; }

  snapshot(): BudgetSnapshot {
    return Object.freeze({ readAttempts: this.readAttempts, decisionPhases: this.decisionPhases,
      providerDispatches: this.providerDispatches, providerRequestBytes: this.providerRequestBytes,
      providerEnforcement: this.providerPolicy.enforcement });
  }

  /**
   * Reserve BEFORE each actual provider dispatch, including retry/fan-out/internal
   * Jev batches. Counts cancelled/failed dispatches too. This is not an evaluator
   * count. Unwrapped network calls are outside this controller's enforcement.
   */
  async dispatch<T>(requestUtf8Bytes: number, signal: AbortSignal, send: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(requestUtf8Bytes) || requestUtf8Bytes < 0) throw new ReadControlError('invalid_dispatch_bytes');
    if (this.providerPolicy.enforcement === 'dispatch-guard') {
      if (this.providerDispatches >= this.providerPolicy.maxCalls) throw new ReadControlError('provider_call_budget_exhausted');
      if (this.providerRequestBytes + requestUtf8Bytes > this.providerPolicy.maxRequestBytes) {
        throw new ReadControlError('provider_byte_budget_exhausted');
      }
    }
    this.providerDispatches++;
    this.providerRequestBytes += requestUtf8Bytes;
    const result = await abortable(Promise.resolve().then(() => {
      signal.throwIfAborted();
      return send();
    }), signal);
    signal.throwIfAborted();
    return result;
  }
}
