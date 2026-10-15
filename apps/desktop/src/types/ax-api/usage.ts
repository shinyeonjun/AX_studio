import type { UsagePeriod, UsageReport } from '@ax-studio/core';

export interface AxUsageApi {
  /** Model calls of the period (Jev and LLM decisions, LLM generations), summed per request. */
  getUsageReport: (period: UsagePeriod) => Promise<UsageReport>;
}
