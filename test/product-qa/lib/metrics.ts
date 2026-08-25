import type { ProductQaReport, ScenarioRunResult } from './types.js';

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function buildReport(input: {
  runId: string;
  mode: ProductQaReport['mode'];
  startedAt: string;
  finishedAt: string;
  dataRoot: string;
  strict: boolean;
  tier?: ProductQaReport['tier'];
  scenarios: ScenarioRunResult[];
  replyLatenciesMs: number[];
  coverage?: ProductQaReport['coverage'];
}): ProductQaReport {
  const defects = input.scenarios.flatMap((s) => s.defects.filter((d) => !d.passed));
  const passed = input.scenarios.filter((s) => s.passed).length;
  const failed = input.scenarios.length - passed;

  return {
    runId: input.runId,
    mode: input.mode,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    dataRoot: input.dataRoot,
    strict: input.strict,
    tier: input.tier,
    scenarios: input.scenarios,
    coverage: input.coverage,
    summary: {
      scenarioRuns: input.scenarios.length,
      passed,
      failed,
      defects: defects.length,
      criticalDefects: defects.filter((d) => d.severity === 'critical').length,
      medianReplyMs: percentile(input.replyLatenciesMs, 50),
      p95ReplyMs: percentile(input.replyLatenciesMs, 95),
    },
  };
}
