#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { expressionSignature, validateCatalog } from './cases.mjs';
import { loadCoreAdapter } from './core-adapter.mjs';
import { buildCatalogForProfile, expectedCaseCount, requiredCaseIds } from './expansion-cases.mjs';
import { loadFixtureLab } from './fixture-factory.mjs';
import { aggregateMetrics, METRIC_DEFINITIONS, runBenchmarkCase } from './evaluate.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_FIXTURE_ROOT = 'D:\\ax\\_test\\sweeps\\expanded';
const DEFAULT_OUTPUT_ROOT = 'D:\\ax\\_test\\ablations\\v1-expanded-10-seed';
const DEFAULT_SEEDS = Object.freeze([
  'wd-seed-01',
  'wd-seed-02',
  'wd-seed-03',
  'wd-seed-04',
  'wd-seed-05',
  'wd-seed-06',
  'wd-seed-07',
  'wd-seed-08',
  'wd-seed-09',
  'wd-seed-10',
]);
const VARIANTS = Object.freeze([
  'full',
  'without_replay',
  'without_clarification',
  'without_replay_without_clarification',
]);

function parseSeeds(value) {
  const seeds = String(value).split(',').map((seed) => seed.trim()).filter(Boolean);
  if (seeds.length < 2) throw new Error('ablation_requires_at_least_two_seeds');
  if (new Set(seeds).size !== seeds.length) throw new Error('ablation_duplicate_seed');
  if (seeds.some((seed) => !/^[a-zA-Z0-9._-]+$/.test(seed))) throw new Error('ablation_invalid_seed');
  return seeds;
}

function parseArgs(argv) {
  const options = {
    fixturesRoot: DEFAULT_FIXTURE_ROOT,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    profile: 'expanded',
    seeds: [...DEFAULT_SEEDS],
    report: false,
    verifyEquivalence: false,
    checkContract: false,
    skipBuild: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--report') options.report = true;
    else if (argument === '--verify-equivalence') options.verifyEquivalence = true;
    else if (argument === '--check-contract') options.checkContract = true;
    else if (argument === '--skip-build') options.skipBuild = true;
    else if (argument === '--fixtures-root') options.fixturesRoot = argv[++index] ?? options.fixturesRoot;
    else if (argument === '--output-root') options.outputRoot = argv[++index] ?? options.outputRoot;
    else if (argument === '--profile') options.profile = argv[++index] ?? options.profile;
    else if (argument === '--seeds') options.seeds = parseSeeds(argv[++index] ?? '');
    else if (argument === '--help' || argument === '-h') {
      console.log(`Frozen-v1 Work Discovery ablation comparison

Usage:
  node test/work-discovery-benchmark/ablation.mjs --profile expanded --report --verify-equivalence

Options:
  --fixtures-root <path>  frozen fixture/sweep root (default: D:\\ax\\_test\\sweeps\\expanded)
  --output-root <path>    separate ablation output root (default: D:\\ax\\_test\\ablations\\v1-expanded-10-seed)
  --profile <name>        frozen profile (default: expanded)
  --seeds <csv>           deterministic seed list (default: 10 seeds)
  --report                write raw and aggregate reports
  --verify-equivalence    fail if the independent fourth path differs from No Replay
  --check-contract        validate the frozen profile contract only
  --skip-build            use the existing Core dist
`);
      options.help = true;
    } else throw new Error(`unknown_argument:${argument}`);
  }
  return options;
}

function ensureCoreBuild(skipBuild) {
  if (skipBuild) return;
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd run build -w @ax-studio/core']
    : ['run', 'build', '-w', '@ax-studio/core'];
  const result = spawnSync(command, args, { cwd: repoRoot, env: process.env, stdio: 'inherit' });
  if (result.error) throw new Error(`core_build_start_failed:${result.error.message}`);
  if (result.status !== 0) throw new Error(`core_build_failed:${result.status}`);
}

function sourceIdFromExpression(expression) {
  if (expression.op === 'source') return expression.sourceId;
  if ('input' in expression) return sourceIdFromExpression(expression.input);
  if (expression.op === 'ratio') {
    return sourceIdFromExpression(expression.numerator) ?? sourceIdFromExpression(expression.denominator);
  }
  return undefined;
}

function stableCandidateSignature(candidate) {
  return `${sourceIdFromExpression(candidate.expr) ?? 'unknown'}:${expressionSignature(candidate.expr)}`;
}

function candidateToEnumerated(candidate) {
  return {
    id: candidate.id,
    observationPath: candidate.observationPath,
    expr: candidate.expr,
    simplicity: candidate.score?.simplicity ?? candidate.simplicity ?? 0,
  };
}

function candidateToOutput(candidate) {
  if (!candidate) return undefined;
  return {
    sourceId: sourceIdFromExpression(candidate.expr),
    expression: candidate.expr,
    signature: expressionSignature(candidate.expr),
    replay: candidate.score?.replay,
    simplicity: candidate.score?.simplicity ?? candidate.simplicity,
  };
}

function replayExamples(examples) {
  return examples.map((example) => ({
    exampleId: example.id,
    observations: example.observations,
  }));
}

function snapshotsByExample(examples) {
  return Object.fromEntries(examples.map((example) => [example.id, example.snapshots]));
}

function everyReplayPass(candidate) {
  return candidate?.replayResults?.length > 0 && candidate.replayResults.every((entry) => entry.pass);
}

function holdoutResult(item, candidate, core) {
  if (!candidate) return { tested: false, pass: false, replayResults: [] };
  const replayed = core.replayCandidates({
    candidates: [candidateToEnumerated(candidate)],
    examples: replayExamples(item.holdout),
    snapshotsByExample: snapshotsByExample(item.holdout),
  });
  const replayedCandidate = replayed[0];
  return {
    tested: true,
    pass: everyReplayPass(replayedCandidate),
    replayResults: replayedCandidate?.replayResults ?? [],
  };
}

function bestNoReplayCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    const leftPrimary = left.simplicity ?? 0;
    const rightPrimary = right.simplicity ?? 0;
    if (rightPrimary !== leftPrimary) return rightPrimary - leftPrimary;
    return stableCandidateSignature(left).localeCompare(stableCandidateSignature(right));
  })[0];
}

function runNoReplayNoClarification(item, core) {
  const startedAt = performance.now();
  const observations = item.examples.flatMap((example) => example.observations);
  const enumerated = core.enumerateCandidates(
    observations,
    item.sources,
    item.examples[0]?.snapshots ?? {},
  );
  const selected = bestNoReplayCandidate(enumerated);
  if (!selected) {
    return {
      outcome: 'no_match',
      holdout: { tested: false, pass: false, replayResults: [] },
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      variant: 'without_replay_without_clarification',
    };
  }
  return {
    outcome: 'publish',
    candidate: candidateToOutput(selected),
    holdout: holdoutResult(item, selected, core),
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    variant: 'without_replay_without_clarification',
  };
}

function scoreCase(item, variantResult) {
  const expected = item.expected.outcome;
  const published = variantResult.outcome === 'publish';
  const candidate = variantResult.candidate;
  const expressionCorrect = published && item.expected.expressionSignatures.includes(candidate?.signature);
  const sourceCorrect = published && item.expected.sourceIds.includes(candidate?.sourceId);
  const holdoutCorrect = published && variantResult.holdout.pass;
  const correctPublish = expected === 'publish' && published && expressionCorrect && sourceCorrect && holdoutCorrect;
  const correctDecision = expected === variantResult.outcome;
  const unsafePublish = published && !correctPublish;
  return {
    expected,
    actual: variantResult.outcome,
    correctDecision,
    correctPublish,
    unsafePublish,
    expressionCorrect,
    sourceCorrect,
    holdoutCorrect,
  };
}

function addFourthVariant(item, core) {
  const base = runBenchmarkCase(item, core);
  const raw = runNoReplayNoClarification(item, core);
  const combined = { ...raw, score: scoreCase(item, raw) };
  return {
    ...base,
    variants: {
      ...base.variants,
      without_replay_without_clarification: combined,
    },
  };
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function aggregateVariant(results, variant) {
  const rows = results.map((result) => result.variants[variant]);
  const expectedPublish = rows.filter((row) => row.score.expected === 'publish');
  const expectedNonPublish = rows.filter((row) => row.score.expected !== 'publish');
  const published = rows.filter((row) => row.outcome === 'publish');
  const publishedWithHoldout = published.filter((row) => row.holdout.tested);
  const passedHoldout = publishedWithHoldout.filter((row) => row.holdout.pass).length;
  const correctDecision = rows.filter((row) => row.score.correctDecision).length;
  const correctPublish = rows.filter((row) => row.score.correctPublish).length;
  const unsafePublish = rows.filter((row) => row.score.unsafePublish).length;
  const expectedNonPublishPublished = rows.filter((row) => row.score.expected !== 'publish' && row.outcome === 'publish').length;
  const hiddenHoldoutGeneralizationFailures = rows.filter((row) =>
    row.outcome === 'publish' && row.holdout.tested && !row.holdout.pass,
  ).length;
  const sourceCorrect = rows.filter((row) => row.score.expected === 'publish' && row.score.sourceCorrect).length;
  const clarificationCount = rows.filter((row) => row.outcome === 'clarify').length;
  const latency = rows.reduce((sum, row) => sum + row.durationMs, 0);
  return {
    cases: rows.length,
    correctPublish,
    correctPublishRate: rate(correctPublish, expectedPublish.length),
    falsePublish: unsafePublish,
    falsePublishRate: rate(unsafePublish, published.length),
    falsePublishRateAmongExpectedNonPublish: rate(expectedNonPublishPublished, expectedNonPublish.length),
    safeDecisionRate: rate(correctDecision, rows.length),
    holdoutOutputAccuracy: rate(correctPublish, expectedPublish.length),
    holdoutPassRate: rate(passedHoldout, publishedWithHoldout.length),
    sourceRecoveryAccuracy: rate(sourceCorrect, expectedPublish.length),
    clarificationCount,
    clarificationRate: rate(clarificationCount, rows.length),
    averageDiscoveryLatencyMs: Number((latency / rows.length).toFixed(3)),
    denominators: {
      allCases: rows.length,
      expectedPublish: expectedPublish.length,
      expectedNonPublish: expectedNonPublish.length,
      actualPublish: published.length,
      publishedWithHoldout: publishedWithHoldout.length,
    },
    numerators: {
      correctPublish,
      unsafePublish,
      expectedNonPublishPublished,
      correctDecision,
      passedHoldout,
      sourceCorrect,
      hiddenHoldoutGeneralizationFailures,
    },
  };
}

function allMetrics(results) {
  const metrics = aggregateMetrics(results);
  metrics.without_replay_without_clarification = aggregateVariant(results, 'without_replay_without_clarification');
  return metrics;
}

function comparableVariant(result) {
  return {
    outcome: result.outcome,
    candidate: result.candidate ? {
      sourceId: result.candidate.sourceId,
      signature: result.candidate.signature,
    } : null,
    holdout: {
      tested: result.holdout?.tested ?? false,
      pass: result.holdout?.pass ?? false,
      replayResults: result.holdout?.replayResults ?? [],
    },
    score: result.score,
  };
}

function semanticMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([variant, value]) => [variant, {
    ...value,
    averageDiscoveryLatencyMs: undefined,
  }]));
}

function equivalenceReport(results, metrics) {
  const mismatches = [];
  for (const result of results) {
    const reference = comparableVariant(result.variants.without_replay);
    const target = comparableVariant(result.variants.without_replay_without_clarification);
    if (JSON.stringify(reference) !== JSON.stringify(target)) {
      mismatches.push({ seed: result.seed, caseId: result.id, reference, target });
    }
  }
  const referenceMetrics = { ...metrics.without_replay, averageDiscoveryLatencyMs: undefined };
  const targetMetrics = { ...metrics.without_replay_without_clarification, averageDiscoveryLatencyMs: undefined };
  return {
    reference: 'without_replay',
    target: 'without_replay_without_clarification',
    matchingCases: results.length - mismatches.length,
    mismatches,
    metricsEqual: JSON.stringify(referenceMetrics) === JSON.stringify(targetMetrics),
  };
}

function findingFor(item, result) {
  if (result.outcome === 'publish' && result.holdout?.tested && !result.holdout.pass) {
    return {
      kind: 'hidden_holdout_generalization',
      scope: 'evaluation_only',
      class: item.finding?.class ?? 'algorithmic_limitation',
      reason: item.finding?.label ?? 'The hidden holdout was evaluated after the discovery decision.',
    };
  }
  return {
    kind: 'discovery_decision_mismatch',
    scope: 'observable_discovery',
    class: 'algorithmic_limitation',
    reason: 'The discovery-time decision did not match the independent benchmark contract.',
  };
}

function failures(results) {
  return results.flatMap((item) => Object.entries(item.variants)
    .filter(([, result]) => !result.score.correctDecision || (result.score.expected === 'publish' && !result.score.correctPublish))
    .map(([variant, result]) => {
      const finding = findingFor(item, result);
      return {
        seed: item.seed,
        caseId: item.id,
        title: item.title,
        variant,
        expected: result.score.expected,
        actual: result.score.actual,
        sourceId: result.candidate?.sourceId,
        unsafePublish: result.score.unsafePublish,
        findingKind: finding.kind,
        findingClass: finding.class,
        findingScope: finding.scope,
        findingReason: finding.reason,
      };
    }));
}

function metricPercent(value) {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

function markdown(report) {
  const lines = [
    '# Work Discovery Benchmark v1 ablation comparison',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Frozen fixture root: ${report.fixtureRoot}`,
    `- Profile: ${report.profile}`,
    `- Seeds: ${report.seedCount}`,
    `- Total cases: ${report.totalCases}`,
    '- Network access: disabled',
    '- External side effects: none',
    '',
    'This is an additive comparison over the frozen v1 inputs. Existing v1',
    'reports and the v1 SHA-256 manifest are not rewritten.',
    '',
    '## Aggregate comparison',
    '',
    '| Condition | Correct publish | False publish | Expected non-publish published | Safe decision | Holdout pass | Clarifications |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const variant of VARIANTS) {
    const metrics = report.metrics[variant];
    lines.push(`| ${report.conditions[variant].label} | ${metricPercent(metrics.correctPublishRate)} | ${metricPercent(metrics.falsePublishRate)} | ${metricPercent(metrics.falsePublishRateAmongExpectedNonPublish)} | ${metricPercent(metrics.safeDecisionRate)} | ${metricPercent(metrics.holdoutPassRate)} | ${metrics.clarificationCount} |`);
  }
  lines.push(
    '',
    'The false-publish rate denominator is actual publishes. The expected',
    'non-publish column uses all expected `clarify`/`no_match` cases as its',
    'denominator. Every metric also has stored numerator and denominator values in',
    'the JSON report.',
    '',
    '## Equivalence check',
    '',
    `- Reference: ${report.equivalence.reference}`,
    `- Independent target: ${report.equivalence.target}`,
    `- Matching scenario outcomes: ${report.equivalence.matchingCases}/${report.totalCases}`,
    `- Aggregate decision metrics equal: ${report.equivalence.metricsEqual ? 'PASS' : 'FAIL'}`,
    '- The equality is expected because the existing No Replay path already',
    'does not enter clarification; the fourth condition still executes its own',
    'no-replay/no-clarification selection path.',
    '',
    '## Seed-level comparison',
    '',
    '| Seed | Full safe decision | No Replay false publish | No Clarification false publish | Combined false publish | Combined safe decision |',
    '|---|---:|---:|---:|---:|---:|',
  );
  for (const entry of report.seedReports) {
    lines.push(`| ${entry.seed} | ${metricPercent(entry.metrics.full.safeDecisionRate)} | ${metricPercent(entry.metrics.without_replay.falsePublishRate)} | ${metricPercent(entry.metrics.without_clarification.falsePublishRate)} | ${metricPercent(entry.metrics.without_replay_without_clarification.falsePublishRate)} | ${metricPercent(entry.metrics.without_replay_without_clarification.safeDecisionRate)} |`);
  }
  lines.push(
    '',
    '## Boundary',
    '',
    '- The fixture/gold/seed/holdout inputs are loaded from the frozen sweep',
    'root and are not generated or rewritten by this runner.',
    '- Holdout remains a post-decision evaluation only.',
    '- B24~B26 classifications remain attached to the raw case results and are',
    'not used to alter any condition.',
    '- Raw scenario results, failures, and the aggregate report are written to',
    'the separate ablation output root.',
  );
  return `${lines.join('\n')}\n`;
}

function failureMarkdown(rows) {
  const lines = [
    '# Work Discovery Benchmark v1 ablation failures',
    '',
    '| Seed | Case | Variant | Expected | Actual | Finding | Class | Scope | Unsafe publish |',
    '|---|---|---|---|---|---|---|---|---:|',
  ];
  for (const row of rows) {
    lines.push(`| ${row.seed} | ${row.caseId} ${row.title} | ${row.variant} | ${row.expected} | ${row.actual} | ${row.findingKind} | ${row.findingClass} | ${row.findingScope} | ${row.unsafePublish ? 'yes' : 'no'} |`);
  }
  if (rows.length === 0) lines.push('| - | - | - | - | - | - | - | - | - |');
  return `${lines.join('\n')}\n`;
}

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex').toUpperCase();
}

async function assertFrozenAggregate(fixturesRoot, profile, seeds) {
  const aggregatePath = join(resolve(fixturesRoot), 'runs', 'latest-aggregate.json');
  const aggregate = JSON.parse(await readFile(aggregatePath, 'utf8'));
  if (aggregate.version !== 'v1' || aggregate.profile !== profile || aggregate.seedCount !== seeds.length) {
    throw new Error('frozen_aggregate_identity_mismatch');
  }
  const expectedTotal = expectedCaseCount(profile) * seeds.length;
  if (aggregate.totalCases !== expectedTotal) throw new Error('frozen_aggregate_case_count_mismatch');
  return { aggregatePath, aggregate };
}

function validateFrozenContract(profile, seeds) {
  const expectedCount = expectedCaseCount(profile);
  const requiredIds = requiredCaseIds(profile);
  for (const seed of seeds) {
    const result = validateCatalog(buildCatalogForProfile(seed, profile), expectedCount, requiredIds);
    console.log(`[wd-ablation] contract PASS seed=${seed} profile=${profile} cases=${result.caseCount}`);
  }
}

function printSummary(report) {
  console.log(`\n[wd-ablation] profile=${report.profile} seeds=${report.seedCount} cases=${report.totalCases}`);
  for (const variant of VARIANTS) {
    const metrics = report.metrics[variant];
    console.log(`[wd-ablation] ${variant} correctPublish=${metrics.correctPublishRate ?? '-'} falsePublish=${metrics.falsePublishRate ?? '-'} safeDecision=${metrics.safeDecisionRate ?? '-'} holdout=${metrics.holdoutOutputAccuracy ?? '-'}`);
  }
  console.log(`[wd-ablation] equivalence=${report.equivalence.matchingCases}/${report.totalCases} metricsEqual=${report.equivalence.metricsEqual}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return;
  if (options.profile !== 'expanded') throw new Error('ablation_requires_frozen_expanded_profile');
  validateFrozenContract(options.profile, options.seeds);
  if (options.checkContract) return;

  ensureCoreBuild(options.skipBuild);
  const fixturesRoot = resolve(options.fixturesRoot);
  const outputRoot = resolve(options.outputRoot);
  const frozenAggregate = await assertFrozenAggregate(fixturesRoot, options.profile, options.seeds);
  const core = await loadCoreAdapter(repoRoot);
  const results = [];
  const seedReports = [];
  for (const seed of options.seeds) {
    const lab = await loadFixtureLab(join(fixturesRoot, 'seeds', seed));
    if (lab.manifest.seed !== seed || lab.manifest.profile !== options.profile) {
      throw new Error(`frozen_fixture_identity_mismatch:${seed}`);
    }
    const seedResults = lab.cases.map((item) => ({ ...addFourthVariant(item, core), seed }));
    const seedMetrics = allMetrics(seedResults);
    results.push(...seedResults);
    seedReports.push({
      seed,
      caseCount: seedResults.length,
      metrics: seedMetrics,
      failureCount: failures(seedResults).length,
    });
    console.log(`[wd-ablation] seed=${seed} cases=${seedResults.length} combinedSafeDecision=${seedMetrics.without_replay_without_clarification.safeDecisionRate ?? '-'}`);
  }

  const metrics = allMetrics(results);
  const report = {
    schemaVersion: 1,
    benchmark: 'work-discovery',
    version: 'v1-ablation',
    sourceVersion: 'v1',
    reportType: 'ablation-comparison',
    generatedAt: new Date().toISOString(),
    fixtureRoot: fixturesRoot,
    frozenAggregatePath: frozenAggregate.aggregatePath,
    profile: options.profile,
    seeds: options.seeds,
    seedCount: options.seeds.length,
    caseCountPerSeed: expectedCaseCount(options.profile),
    totalCases: results.length,
    networkAccess: false,
    sideEffectAdapters: [],
    metricDefinitions: METRIC_DEFINITIONS,
    conditions: {
      full: { label: 'Full', description: 'Existing frozen Full path' },
      without_replay: { label: 'No Replay', description: 'Existing frozen no-training-replay path' },
      without_clarification: { label: 'No Clarification', description: 'Existing frozen auto-select path' },
      without_replay_without_clarification: { label: 'No Replay + No Clarification', description: 'Independent additive fourth path' },
    },
    metrics,
    equivalence: equivalenceReport(results, metrics),
    seedReports,
    failures: failures(results),
    cases: results,
  };
  if (options.verifyEquivalence) {
    if (report.equivalence.matchingCases !== report.totalCases || !report.equivalence.metricsEqual) {
      throw new Error('no_replay_combined_equivalence_failed');
    }
  }

  const aggregateHash = await sha256(frozenAggregate.aggregatePath);
  const outputManifest = {
    schemaVersion: 1,
    benchmark: 'work-discovery',
    version: 'v1-ablation',
    sourceVersion: 'v1',
    profile: options.profile,
    seeds: options.seeds,
    caseCountPerSeed: report.caseCountPerSeed,
    totalCases: report.totalCases,
    frozenAggregatePath: frozenAggregate.aggregatePath,
    frozenAggregateSha256: aggregateHash,
    conditions: VARIANTS,
    equivalence: report.equivalence,
    generatedAt: report.generatedAt,
    networkAccess: false,
    sideEffectAdapters: [],
  };
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const reportRoot = join(outputRoot, 'runs', stamp);
  await mkdir(reportRoot, { recursive: true });
  const serializable = { ...report, markdown: undefined };
  const json = `${JSON.stringify(serializable, null, 2)}\n`;
  const reportMarkdown = markdown(report);
  const failureRows = report.failures;
  await writeFile(join(reportRoot, 'report.json'), json, 'utf8');
  await writeFile(join(reportRoot, 'report.md'), reportMarkdown, 'utf8');
  await writeFile(join(reportRoot, 'failures.json'), `${JSON.stringify(failureRows, null, 2)}\n`, 'utf8');
  await writeFile(join(reportRoot, 'failures.md'), failureMarkdown(failureRows), 'utf8');
  await writeFile(join(reportRoot, 'manifest.json'), `${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, 'latest.json'), json, 'utf8');
  await writeFile(join(outputRoot, 'latest.md'), reportMarkdown, 'utf8');
  await writeFile(join(outputRoot, 'latest-failures.json'), `${JSON.stringify(failureRows, null, 2)}\n`, 'utf8');
  await writeFile(join(outputRoot, 'latest-failures.md'), failureMarkdown(failureRows), 'utf8');
  await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');
  printSummary(report);
  console.log(`[wd-ablation] report=${join(outputRoot, 'latest.md')}`);
}

main().catch((error) => {
  console.error(`[wd-ablation] ${error.message}`);
  process.exitCode = 1;
});

export { DEFAULT_SEEDS, VARIANTS };
