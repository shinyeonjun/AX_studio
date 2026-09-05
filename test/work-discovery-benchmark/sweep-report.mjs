import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { METRIC_DEFINITIONS } from './evaluate.mjs';

function metricPercent(value) {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

function safe(value) {
  return value === null || value === undefined ? '-' : String(value);
}

function seedMetricRows(seedReports) {
  return seedReports.map((entry) => {
    const full = entry.metrics.full;
    const replay = entry.metrics.without_replay;
    const clarification = entry.metrics.without_clarification;
    return `| ${entry.seed} | ${metricPercent(full.safeDecisionRate)} | ${metricPercent(full.falsePublishRate)} | ${metricPercent(replay.falsePublishRate)} | ${metricPercent(clarification.falsePublishRate)} | ${entry.failureCount} |`;
  });
}

function failureMarkdown(failures) {
  const lines = [
    '# Work Discovery Benchmark Sweep Failure Report',
    '',
    'These rows preserve mismatches from individual deterministic seeds.',
    'They are evidence for the next investigation, not rewritten gold answers.',
    '',
    '| Seed | Case | Variant | Expected | Actual | Finding | Class | Scope | Reason | Holdout | Unsafe publish |',
    '|---|---|---|---|---|---|---|---|---|---:|---:|',
  ];
  for (const failure of failures) {
    lines.push(`| ${failure.seed} | ${failure.caseId} ${failure.title} | ${failure.variant} | ${failure.expected} | ${failure.actual} | ${failure.findingKind} | ${failure.findingClass} | ${failure.findingScope} | ${failure.findingReason} | ${failure.holdoutCorrect ? 'pass' : 'fail'} | ${failure.unsafePublish ? 'yes' : 'no'} |`);
  }
  if (failures.length === 0) lines.push('| - | - | - | - | - | - | - | - | - | - | - |');
  return `${lines.join('\n')}\n`;
}

function buildMarkdown(report) {
  const lines = [
    '# Work Discovery Benchmark Multi-seed Sweep',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Profile: ${report.profile}`,
    `- Seeds: ${report.seedCount}`,
    `- Cases per seed: ${report.caseCountPerSeed}`,
    `- Total evaluated cases: ${report.totalCases}`,
    '- Network access: disabled',
    '- External side effects: none',
    '',
    '## Pooled metrics',
    '',
    '| Variant | Correct publish | False publish | Safe decision | Holdout accuracy | Source recovery | Clarifications | Avg latency |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [variant, metrics] of Object.entries(report.metrics)) {
    lines.push(`| ${variant} | ${metricPercent(metrics.correctPublishRate)} | ${metricPercent(metrics.falsePublishRate)} | ${metricPercent(metrics.safeDecisionRate)} | ${metricPercent(metrics.holdoutOutputAccuracy)} | ${metricPercent(metrics.sourceRecoveryAccuracy)} | ${metrics.clarificationCount} | ${safe(metrics.averageDiscoveryLatencyMs)}ms |`);
  }
  lines.push('', '## Metric definitions', '', '| Metric | Numerator | Denominator | Eligible cases |', '|---|---|---|---|');
  for (const [name, definition] of Object.entries(report.metricDefinitions)) {
    lines.push(`| ${name} | ${definition.numerator} | ${definition.denominator} | ${definition.eligible} |`);
  }
  lines.push('', '## Seed-level metrics', '', '| Seed | Full safe decision | Full false publish | No replay false publish | No clarification false publish | Failures |', '|---|---:|---:|---:|---:|---:|');
  lines.push(...seedMetricRows(report.seedReports));
  lines.push('', '## Safety verification', '', `- Full unsafe publishes across seeds: ${report.safety.fullUnsafePublishes}`, `- Full expected-safe outcome failures across seeds: ${report.safety.fullSafeOutcomeFailures}`, `- Hidden holdout generalization failures across seeds: ${report.safety.fullHiddenHoldoutGeneralizationFailures} (evaluation-only; hidden data was not passed to discovery or publish)`, `- Side-effect adapters: ${report.safety.sideEffectAdapters.length === 0 ? 'none' : report.safety.sideEffectAdapters.join(', ')}`);
  lines.push('', '## Failure report', '', `- Total variant mismatches: ${report.failures.length}`, `- Full variant mismatches: ${report.failures.filter((failure) => failure.variant === 'full').length}`, '- Detailed evidence: `latest-aggregate-failures.md` and `latest-aggregate-failures.json`');
  return `${lines.join('\n')}\n`;
}

export function buildSweepReport({ root, profile, seeds, seedReports, metrics, failures, generatedAt }) {
  const caseCounts = new Set(seedReports.map((entry) => entry.caseCount));
  if (caseCounts.size !== 1) throw new Error('sweep_case_count_mismatch');
  const report = {
    schemaVersion: 1,
    benchmark: 'work-discovery',
    version: 'v1',
    reportType: 'multi-seed-sweep',
    generatedAt,
    root,
    profile,
    seeds,
    seedCount: seeds.length,
    caseCountPerSeed: seedReports[0]?.caseCount ?? 0,
    totalCases: seedReports.reduce((sum, entry) => sum + entry.caseCount, 0),
    networkAccess: false,
    sideEffectAdapters: [],
    metricDefinitions: METRIC_DEFINITIONS,
    metrics,
    safety: {
      fullUnsafePublishes: seedReports.reduce((sum, entry) => sum + entry.safety.fullUnsafePublishes, 0),
      fullSafeOutcomeFailures: seedReports.reduce((sum, entry) => sum + entry.safety.fullSafeOutcomeFailures, 0),
      fullHiddenHoldoutGeneralizationFailures: seedReports.reduce((sum, entry) => sum + entry.safety.fullHiddenHoldoutGeneralizationFailures, 0),
      sideEffectAdapters: [],
    },
    seedReports,
    failures,
  };
  return { ...report, markdown: buildMarkdown(report) };
}

export async function writeSweepReport(root, report) {
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const reportRoot = join(root, 'runs', `aggregate-${stamp}`);
  const serializable = { ...report, markdown: undefined };
  const json = `${JSON.stringify(serializable, null, 2)}\n`;
  await mkdir(reportRoot, { recursive: true });
  await writeFile(join(reportRoot, 'aggregate.json'), json, 'utf8');
  await writeFile(join(reportRoot, 'aggregate.md'), report.markdown, 'utf8');
  await writeFile(join(reportRoot, 'failures.json'), `${JSON.stringify(report.failures, null, 2)}\n`, 'utf8');
  await writeFile(join(reportRoot, 'failures.md'), failureMarkdown(report.failures), 'utf8');
  await writeFile(join(root, 'runs', 'latest-aggregate.json'), json, 'utf8');
  await writeFile(join(root, 'runs', 'latest-aggregate.md'), report.markdown, 'utf8');
  await writeFile(join(root, 'runs', 'latest-aggregate-failures.json'), `${JSON.stringify(report.failures, null, 2)}\n`, 'utf8');
  await writeFile(join(root, 'runs', 'latest-aggregate-failures.md'), failureMarkdown(report.failures), 'utf8');
  return { reportRoot, markdownPath: join(reportRoot, 'aggregate.md') };
}
