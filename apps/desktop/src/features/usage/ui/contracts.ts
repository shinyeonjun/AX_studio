import type { UsagePeriod, UsageReport, UsageSummary } from '@ax-studio/core';

export type { UsagePeriod, UsageSummary };

/** Who decided a chat request: Jev answering bounded questions, or an LLM. */
export type DecisionMode = keyof UsageReport['decision'];

export type DecisionUsageComparison = UsageReport['decision'];

export const USAGE_PERIOD_LABELS: Record<UsagePeriod, string> = {
  today: '오늘',
  week: '최근 7일',
  month: '최근 30일',
};

export const MODE_LABELS: Record<DecisionMode, string> = {
  jev: 'Jev',
  llm: 'LLM',
};
