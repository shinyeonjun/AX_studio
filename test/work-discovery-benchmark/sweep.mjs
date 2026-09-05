#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './cases.mjs';
import { loadCoreAdapter } from './core-adapter.mjs';
import { buildCatalogForProfile, expectedCaseCount, requiredCaseIds } from './expansion-cases.mjs';
import { generateFixtureLab, loadFixtureLab } from './fixture-factory.mjs';
import { aggregateMetrics, runBenchmarkCase } from './evaluate.mjs';
import { assertSafety, buildReport, writeReport } from './report.mjs';
import { buildSweepReport, writeSweepReport } from './sweep-report.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultRoot = process.env.AX_TEST_ROOT ?? 'D:\\ax\\_test\\sweeps';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
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

function parseSeeds(value) {
  const seeds = String(value).split(',').map((seed) => seed.trim()).filter(Boolean);
  if (seeds.length < 2) throw new Error('sweep_requires_at_least_two_seeds');
  if (new Set(seeds).size !== seeds.length) throw new Error('sweep_duplicate_seed');
  if (seeds.some((seed) => !/^[a-zA-Z0-9._-]+$/.test(seed))) throw new Error('sweep_invalid_seed');
  return seeds;
}

function parseArgs(argv) {
  const options = {
    root: defaultRoot,
    profile: process.env.AX_WD_BENCHMARK_PROFILE ?? 'expanded',
    seeds: [...DEFAULT_SEEDS],
    generate: false,
    report: false,
    verifySafety: false,
    checkContract: false,
    skipBuild: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--generate') options.generate = true;
    else if (argument === '--report') options.report = true;
    else if (argument === '--verify-safety') options.verifySafety = true;
    else if (argument === '--check-contract') options.checkContract = true;
    else if (argument === '--skip-build') options.skipBuild = true;
    else if (argument === '--root') options.root = argv[++index] ?? defaultRoot;
    else if (argument === '--profile') options.profile = argv[++index] ?? options.profile;
    else if (argument === '--seeds') options.seeds = parseSeeds(argv[++index] ?? '');
    else throw new Error(`unknown_argument:${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Work Discovery Benchmark multi-seed sweep

Usage:
  npm run test:wd-benchmark:sweep -- --profile expanded --generate --report
  npm run test:wd-benchmark:sweep -- --profile schema-drift --generate --report --verify-safety
  npm run test:wd-benchmark:sweep -- --profile expanded --seeds wd-a,wd-b,wd-c --report

Options:
  --root <path>       sweep root (default: D:\\ax\\_test\\sweeps)
  --profile <name>    v1, rotating, schema-drift, source-confusion, holdout, input-variation, or expanded (default: expanded)
  --seeds <csv>       comma-separated deterministic seeds (default: 10 seeds)
  --generate          create/update each seed's external fixture lab
  --report            write per-seed and aggregate JSON/Markdown reports
  --verify-safety     fail if any seed violates the Full safety gate
  --check-contract    validate the profile contract for every seed
  --skip-build        use the existing Core dist
`);
}

function ensureCoreBuild(skipBuild) {
  if (skipBuild) return;
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : npmCommand;
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `${npmCommand} run build -w @ax-studio/core`]
    : ['run', 'build', '-w', '@ax-studio/core'];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`core_build_start_failed:${result.error.message}`);
  if (result.status !== 0) throw new Error(`core_build_failed:${result.status}`);
}

function seedRoot(root, seed) {
  return join(resolve(root), 'seeds', seed);
}

function printSummary(report) {
  console.log(`\n[wd-sweep] profile=${report.profile} seeds=${report.seedCount} cases=${report.totalCases}`);
  for (const [variant, metrics] of Object.entries(report.metrics)) {
    console.log(`[wd-sweep] ${variant} correctPublish=${metrics.correctPublishRate ?? '-'} falsePublish=${metrics.falsePublishRate ?? '-'} safeDecision=${metrics.safeDecisionRate ?? '-'} holdout=${metrics.holdoutOutputAccuracy ?? '-'}`);
  }
  console.log(`[wd-sweep] Full unsafe publishes=${report.safety.fullUnsafePublishes} safe-outcome failures=${report.safety.fullSafeOutcomeFailures}`);
}

async function validateContracts(options) {
  const expectedCount = expectedCaseCount(options.profile);
  const requiredIds = requiredCaseIds(options.profile);
  for (const seed of options.seeds) {
    const result = validateCatalog(buildCatalogForProfile(seed, options.profile), expectedCount, requiredIds);
    console.log(`[wd-sweep] contract PASS seed=${seed} profile=${options.profile} cases=${result.caseCount}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.checkContract) {
    await validateContracts(options);
    return;
  }

  ensureCoreBuild(options.skipBuild);
  const root = resolve(options.root);
  const core = await loadCoreAdapter(repoRoot);
  const seedReports = [];
  const allCases = [];
  for (const seed of options.seeds) {
    const rootForSeed = seedRoot(root, seed);
    if (options.generate) await generateFixtureLab(rootForSeed, seed, options.profile);
    const lab = await loadFixtureLab(rootForSeed);
    const cases = lab.cases.map((item) => runBenchmarkCase(item, core));
    allCases.push(...cases);
    const report = buildReport({
      root: lab.root,
      manifest: lab.manifest,
      cases,
      metrics: aggregateMetrics(cases),
      generatedAt: new Date().toISOString(),
    });
    if (options.report || options.verifySafety) await writeReport(lab.root, report);
    if (options.verifySafety) assertSafety(report);
    seedReports.push({
      seed,
      root: lab.root,
      caseCount: cases.length,
      metrics: report.metrics,
      safety: report.safety,
      failureCount: report.failures.length,
      reportPath: options.report || options.verifySafety ? join(lab.root, 'runs', 'latest.md') : undefined,
      failures: report.failures.map((failure) => ({ seed, ...failure })),
    });
    console.log(`[wd-sweep] seed=${seed} cases=${cases.length} fullSafeDecision=${report.metrics.full.safeDecisionRate ?? '-'} fullFalsePublish=${report.metrics.full.falsePublishRate ?? '-'}`);
  }

  const report = buildSweepReport({
    root,
    profile: options.profile,
    seeds: options.seeds,
    seedReports: seedReports.map(({ failures, ...summary }) => summary),
    metrics: aggregateMetrics(allCases),
    failures: seedReports.flatMap((entry) => entry.failures),
    generatedAt: new Date().toISOString(),
  });
  printSummary(report);
  if (options.report || options.verifySafety) {
    const paths = await writeSweepReport(root, report);
    console.log(`[wd-sweep] aggregate=${paths.markdownPath}`);
  }
}

main().catch((error) => {
  console.error(`[wd-sweep] ${error.message}`);
  process.exitCode = 1;
});

export { DEFAULT_SEEDS };
