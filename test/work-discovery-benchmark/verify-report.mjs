#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REQUIRED_METRICS = [
  'correctPublishRate',
  'falsePublishRate',
  'falsePublishRateAmongExpectedNonPublish',
  'safeDecisionRate',
  'holdoutOutputAccuracy',
  'holdoutPassRate',
  'sourceRecoveryAccuracy',
];

function parseOptions(argv) {
  const index = argv.indexOf('--root');
  return {
    root: resolve(index >= 0 ? argv[index + 1] ?? 'D:\\ax\\_test' : 'D:\\ax\\_test'),
    aggregate: argv.includes('--aggregate'),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ids(entries) {
  return entries.map((entry) => entry.exampleId);
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function assertMetricArithmetic(metrics, variant) {
  const numerators = metrics.numerators;
  const denominators = metrics.denominators;
  const checks = [
    ['correctPublishRate', numerators.correctPublish, denominators.expectedPublish],
    ['falsePublishRate', numerators.unsafePublish, denominators.actualPublish],
    ['falsePublishRateAmongExpectedNonPublish', numerators.expectedNonPublishPublished, denominators.expectedNonPublish],
    ['safeDecisionRate', numerators.correctDecision, denominators.allCases],
    ['holdoutOutputAccuracy', numerators.correctPublish, denominators.expectedPublish],
    ['holdoutPassRate', numerators.passedHoldout, denominators.publishedWithHoldout],
    ['sourceRecoveryAccuracy', numerators.sourceCorrect, denominators.expectedPublish],
  ];
  for (const [metric, numerator, denominator] of checks) {
    assert(metrics[metric] === rate(numerator, denominator), `metric_arithmetic_mismatch:${variant}:${metric}`);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const root = options.root;
  const reportPath = join(root, 'runs', options.aggregate ? 'latest-aggregate.json' : 'latest.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));

  assert(report.networkAccess === false, 'report_network_access_enabled');
  assert(Array.isArray(report.sideEffectAdapters) && report.sideEffectAdapters.length === 0, 'report_side_effect_adapter_enabled');
  for (const metric of REQUIRED_METRICS) {
    const definition = report.metricDefinitions?.[metric];
    assert(definition?.numerator && definition?.denominator && definition?.eligible, `metric_definition_missing:${metric}`);
  }
  for (const variant of ['full', 'without_replay', 'without_clarification']) {
    const metrics = report.metrics?.[variant];
    assert(metrics?.numerators && metrics?.denominators, `metric_arithmetic_missing:${variant}`);
    assertMetricArithmetic(metrics, variant);
  }

  if (options.aggregate) {
    assert(report.reportType === 'multi-seed-sweep', 'aggregate_report_type_missing');
    assert(report.seedCount >= 2, 'aggregate_seed_count_invalid');
    for (const caseId of ['B24', 'B25', 'B26']) {
      const failures = report.failures.filter((entry) => entry.caseId === caseId && entry.variant === 'full');
      assert(failures.length >= report.seedCount, `aggregate_failure_count:${caseId}`);
      assert(failures.every((failure) => failure.findingKind === 'hidden_holdout_generalization'), `aggregate_finding_kind:${caseId}`);
      assert(failures.every((failure) => failure.findingScope === 'evaluation_only'), `aggregate_finding_scope:${caseId}`);
      assert(failures.every((failure) => failure.discoveryEvidence?.exampleIds?.length === 3), `aggregate_training_evidence:${caseId}`);
      assert(failures.every((failure) => failure.holdoutEvidence?.examples?.length === 2), `aggregate_holdout_evidence:${caseId}`);
    }
  } else {
    for (const caseId of ['B24', 'B25', 'B26']) {
      const item = report.cases.find((entry) => entry.id === caseId);
      assert(item, `case_missing:${caseId}`);
      const trainingIds = item.training?.evidence?.exampleIds ?? [];
      const holdoutIds = ids(item.holdout ?? []);
      assert(trainingIds.length === 3, `training_example_count:${caseId}`);
      assert(holdoutIds.length === 2, `holdout_example_count:${caseId}`);
      assert(trainingIds.every((id) => id.startsWith('examples_')), `training_phase_invalid:${caseId}`);
      assert(holdoutIds.every((id) => id.startsWith('holdout_')), `holdout_phase_invalid:${caseId}`);
      assert(trainingIds.every((id) => !holdoutIds.includes(id)), `holdout_leaked_into_training:${caseId}`);
      assert(item.variants.full?.holdout?.tested === true, `holdout_not_evaluated:${caseId}`);

      const failure = report.failures.find((entry) => entry.caseId === caseId && entry.variant === 'full');
      assert(failure, `full_failure_missing:${caseId}`);
      assert(failure.findingKind === 'hidden_holdout_generalization', `finding_kind_invalid:${caseId}`);
      assert(failure.findingScope === 'evaluation_only', `finding_scope_invalid:${caseId}`);
      assert(['algorithmic_limitation', 'missing_product_capability'].includes(failure.findingClass), `finding_class_invalid:${caseId}`);
      assert(failure.discoveryEvidence?.exampleIds?.every((id) => !holdoutIds.includes(id)), `failure_training_leak:${caseId}`);
      assert(failure.holdoutEvidence?.examples?.length === 2, `failure_holdout_evidence_missing:${caseId}`);
      assert(failure.publishDecision?.outcome === 'publish', `publish_decision_missing:${caseId}`);
    }
  }

  console.log(`[wd-benchmark] report boundary PASS root=${root} aggregate=${options.aggregate}`);
}

main().catch((error) => {
  console.error(`[wd-benchmark] ${error.message}`);
  process.exitCode = 1;
});
