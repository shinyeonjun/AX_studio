import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { METRIC_DEFINITIONS } from './evaluate.mjs';

function safe(value) {
  return value === null || value === undefined ? '-' : String(value);
}

function metricPercent(value) {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

function classifyFailure(item, result) {
  if (result.outcome === 'publish' && result.holdout?.tested && !result.holdout.pass) {
    return {
      kind: 'hidden_holdout_generalization',
      scope: 'evaluation_only',
      class: item.finding?.class ?? 'algorithmic_limitation',
      reason: item.finding?.label ?? 'The candidate was selected from training evidence; the hidden holdout was evaluated only afterward.',
    };
  }
  return {
    kind: 'discovery_decision_mismatch',
    scope: 'observable_discovery',
    class: 'algorithmic_limitation',
    reason: 'The discovery-time decision did not match the independent benchmark contract.',
  };
}

function failureRows(cases) {
  return cases.flatMap((item) => Object.entries(item.variants)
    .filter(([, result]) => !result.score.correctDecision || (result.score.expected === 'publish' && !result.score.correctPublish))
    .map(([variant, result]) => {
      const finding = classifyFailure(item, result);
      return {
        caseId: item.id,
        title: item.title,
        variant,
        expected: result.score.expected,
        actual: result.score.actual,
        sourceId: result.candidate?.sourceId,
        expressionCorrect: result.score.expressionCorrect,
        holdoutCorrect: result.score.holdoutCorrect,
        unsafePublish: result.score.unsafePublish,
        findingKind: finding.kind,
        findingClass: finding.class,
        findingScope: finding.scope,
        findingReason: finding.reason,
        discoveryEvidence: item.training.evidence,
        publishDecision: {
          outcome: result.outcome,
          candidate: result.candidate,
          candidateCount: result.candidateCount ?? null,
          ambiguousPaths: result.ambiguousPaths ?? [],
        },
        holdoutEvidence: {
          examples: item.holdout,
          result: result.holdout,
        },
      };
    }));
}

function failureMarkdown(failures) {
  const lines = [
    '# Work Discovery Benchmark Failure Report',
    '',
    'This file records mismatches against the independent benchmark contract.',
    'It is evidence for the next investigation, not a rewritten expected result.',
    '',
    '| Case | Variant | Expected | Actual | Source | Finding | Class | Scope | Reason | Holdout | Unsafe publish |',
    '|---|---|---|---|---|---|---|---|---|---:|---:|',
  ];
  for (const failure of failures) {
    lines.push(`| ${failure.caseId} ${failure.title} | ${failure.variant} | ${failure.expected} | ${failure.actual} | ${failure.sourceId ?? '-'} | ${failure.findingKind} | ${failure.findingClass} | ${failure.findingScope} | ${failure.findingReason} | ${failure.holdoutCorrect ? 'pass' : 'fail'} | ${failure.unsafePublish ? 'yes' : 'no'} |`);
  }
  if (failures.length === 0) lines.push('| - | - | - | - | - | - | - | - | - | - | - |');
  return `${lines.join('\n')}\n`;
}

function buildMarkdown(report) {
  const lines = [
    '# Work Discovery Benchmark v1 Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Seed: ${report.seed}`,
    `- Profile: ${report.profile}`,
    `- Cases: ${report.cases.length}`,
    '- Network access: disabled',
    '- External side effects: none',
    '',
    '## Metrics',
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
  lines.push('', 'Metric values also include `numerators` and `denominators` in JSON so pooled rates can be audited without inferring a denominator from a percentage.', '');
  lines.push('## Case decisions', '', '| Case | Expected | Full | Without replay | Without clarification |', '|---|---|---|---|---|');
  for (const item of report.cases) {
    lines.push(`| ${item.id} ${item.title} | ${item.expected.outcome} | ${item.variants.full.outcome} | ${item.variants.without_replay.outcome} | ${item.variants.without_clarification.outcome} |`);
  }
  lines.push('', '## Safety verification', '', `- Full variant unsafe publishes: ${report.safety.fullUnsafePublishes}`, `- Full variant expected safe outcomes preserved: ${report.safety.fullSafeOutcomeFailures === 0 ? 'PASS' : 'FAIL'}`, `- Hidden holdout generalization failures: ${report.safety.fullHiddenHoldoutGeneralizationFailures} (evaluation-only; hidden data was not passed to discovery or publish)`, `- Side-effect adapters: ${report.safety.sideEffectAdapters.length === 0 ? 'none' : report.safety.sideEffectAdapters.join(', ')}`);
  lines.push('', '## Failure report', '', `- Total variant mismatches: ${report.failures.length}`, `- Full variant mismatches: ${report.failures.filter((failure) => failure.variant === 'full').length}`, '- Detailed evidence: `failures.md` and `failures.json`');
  return `${lines.join('\n')}\n`;
}

export function buildReport({ root, manifest, cases, metrics, generatedAt }) {
  const fullUnsafePublishes = cases.filter((item) => item.variants.full.score.unsafePublish).length;
  const fullSafeOutcomeFailures = cases.filter((item) =>
    item.expected.outcome !== 'publish' && item.variants.full.outcome !== item.expected.outcome,
  ).length;
  const fullHiddenHoldoutGeneralizationFailures = cases.filter((item) => {
    const result = item.variants.full;
    return result.outcome === 'publish' && result.holdout?.tested && !result.holdout.pass;
  }).length;
  const failures = failureRows(cases);
  const report = {
    schemaVersion: 1,
    benchmark: 'work-discovery',
    version: 'v1',
    generatedAt,
    root,
    seed: manifest.seed,
    profile: manifest.profile ?? 'v1',
    networkAccess: false,
    sideEffectAdapters: [],
    metricDefinitions: METRIC_DEFINITIONS,
    metrics,
    safety: {
      fullUnsafePublishes,
      fullSafeOutcomeFailures,
      fullHiddenHoldoutGeneralizationFailures,
      sideEffectAdapters: [],
    },
    failures,
    cases,
  };
  return { ...report, markdown: buildMarkdown(report) };
}

export async function writeReport(root, report) {
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const reportRoot = join(root, 'runs', stamp);
  await mkdir(reportRoot, { recursive: true });
  await writeFile(join(reportRoot, 'report.json'), `${JSON.stringify({ ...report, markdown: undefined }, null, 2)}\n`, 'utf8');
  await writeFile(join(reportRoot, 'report.md'), report.markdown, 'utf8');
  await writeFile(join(reportRoot, 'failures.json'), `${JSON.stringify(report.failures, null, 2)}\n`, 'utf8');
  await writeFile(join(reportRoot, 'failures.md'), failureMarkdown(report.failures), 'utf8');
  await writeFile(join(root, 'runs', 'latest.json'), `${JSON.stringify({ ...report, markdown: undefined }, null, 2)}\n`, 'utf8');
  await writeFile(join(root, 'runs', 'latest.md'), report.markdown, 'utf8');
  await writeFile(join(root, 'runs', 'latest-failures.json'), `${JSON.stringify(report.failures, null, 2)}\n`, 'utf8');
  await writeFile(join(root, 'runs', 'latest-failures.md'), failureMarkdown(report.failures), 'utf8');
  return { reportRoot, jsonPath: join(reportRoot, 'report.json'), markdownPath: join(reportRoot, 'report.md') };
}

export function assertSafety(report) {
  if (report.networkAccess) throw new Error('benchmark_network_access_enabled');
  if (report.sideEffectAdapters.length > 0) throw new Error('benchmark_side_effect_adapter_enabled');
  if (report.safety.fullUnsafePublishes > 0) throw new Error(`full_variant_unsafe_publish:${report.safety.fullUnsafePublishes}`);
  if (report.safety.fullSafeOutcomeFailures > 0) throw new Error(`full_variant_safe_outcome_failure:${report.safety.fullSafeOutcomeFailures}`);
}
