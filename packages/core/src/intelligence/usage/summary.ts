import { callCostUsd } from './prices.js';
import type { StoredUsageCall, UsageEngine } from './usage-recorder.js';

export type UsagePeriod = 'today' | 'week' | 'month';

/** One engine's calls of one purpose over a period, per request where requests are known. */
export interface UsageSummary {
  /** Chat requests the calls belonged to; a call outside any chat request counts as its own. */
  requests: number;
  calls: number;
  failedCalls: number;
  /** Time spent per request (its calls added up). */
  p50Ms: number;
  p95Ms: number;
  totalMs: number;
  callsPerRequest: number;
  inputTokensPerRequest: number;
  outputTokensPerRequest: number;
  /** USD at official API prices, over the calls whose model has a price. */
  costUsd: number;
  /** Calls with no price (unknown model or no token report); their cost is not in `costUsd`. */
  unpricedCalls: number;
  /** Calls whose provider reported token counts; the token averages cover only these. */
  callsWithTokens: number;
}

export interface UsageReport {
  period: UsagePeriod;
  since: string;
  decision: Record<UsageEngine, UsageSummary | null>;
  generation: UsageSummary | null;
}

export function usagePeriodStart(period: UsagePeriod, now = new Date()): Date {
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(now.getTime() - (period === 'week' ? 7 : 30) * 24 * 60 * 60 * 1000);
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export function summarizeUsageCalls(calls: readonly StoredUsageCall[]): UsageSummary | null {
  if (calls.length === 0) return null;
  const byRequest = new Map<string, StoredUsageCall[]>();
  calls.forEach((call, index) => {
    const key = call.requestId ?? `call:${index}`;
    byRequest.set(key, [...(byRequest.get(key) ?? []), call]);
  });
  const perRequestMs = [...byRequest.values()].map((group) => group.reduce((sum, call) => sum + call.durationMs, 0)).sort((a, b) => a - b);
  const requests = byRequest.size;
  let costUsd = 0;
  let unpricedCalls = 0;
  for (const call of calls) {
    const cost = callCostUsd(call);
    if (cost === undefined) unpricedCalls += 1;
    else costUsd += cost;
  }
  const sum = (read: (call: StoredUsageCall) => number | undefined) => calls.reduce((total, call) => total + (read(call) ?? 0), 0);
  return {
    requests,
    calls: calls.length,
    failedCalls: calls.filter((call) => !call.ok).length,
    p50Ms: percentile(perRequestMs, 0.5),
    p95Ms: percentile(perRequestMs, 0.95),
    totalMs: perRequestMs.reduce((total, ms) => total + ms, 0),
    callsPerRequest: calls.length / requests,
    inputTokensPerRequest: sum((call) => call.inputTokens) / requests,
    outputTokensPerRequest: sum((call) => call.outputTokens) / requests,
    costUsd,
    unpricedCalls,
    callsWithTokens: calls.filter((call) => call.inputTokens !== undefined || call.outputTokens !== undefined).length,
  };
}

export function buildUsageReport(calls: readonly StoredUsageCall[], period: UsagePeriod, since: Date): UsageReport {
  const pick = (purpose: StoredUsageCall['purpose'], engine?: UsageEngine) =>
    calls.filter((call) => call.purpose === purpose && (engine === undefined || call.engine === engine));
  return {
    period,
    since: since.toISOString(),
    decision: { jev: summarizeUsageCalls(pick('decision', 'jev')), llm: summarizeUsageCalls(pick('decision', 'llm')) },
    generation: summarizeUsageCalls(pick('generation')),
  };
}
