/** Who decided a chat request: Jev answering bounded questions, or one LLM call deciding it all. */
export type DecisionMode = 'jev' | 'llm';

export type UsagePeriod = 'today' | 'week' | 'month';

export const USAGE_PERIOD_LABELS: Record<UsagePeriod, string> = {
  today: '오늘',
  week: '최근 7일',
  month: '최근 30일',
};

export const MODE_LABELS: Record<DecisionMode, string> = {
  jev: 'Jev',
  llm: 'LLM',
};

/** One mode's decision usage over a period. */
export interface DecisionUsageSummary {
  requests: number;
  p50Ms: number;
  p95Ms: number;
  /** All decision time in the period. */
  totalMs: number;
  callsPerRequest: number;
  inputTokensPerRequest: number;
  outputTokensPerRequest: number;
  /** USD over the whole period, at official API prices. */
  costUsd: number;
}

export type DecisionUsageComparison = Record<DecisionMode, DecisionUsageSummary | null>;

/**
 * Shown until usage is recorded per request. The numbers are illustrative only (rounded from the
 * offline comparison, Jev vs one-call LLM on the app's model); the screen labels them as an example.
 */
export const SAMPLE_USAGE: DecisionUsageComparison = {
  jev: { requests: 128, p50Ms: 470, p95Ms: 980, totalMs: 68_000, callsPerRequest: 1.9, inputTokensPerRequest: 20_700, outputTokensPerRequest: 2_500, costUsd: 0.11 },
  llm: { requests: 128, p50Ms: 2_800, p95Ms: 8_400, totalMs: 435_000, callsPerRequest: 1, inputTokensPerRequest: 6_100, outputTokensPerRequest: 70, costUsd: 0.92 },
};
