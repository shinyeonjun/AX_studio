#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './cases.mjs';
import { loadCoreAdapter } from './core-adapter.mjs';
import { buildCatalogForProfile, expectedCaseCount, requiredCaseIds } from './expansion-cases.mjs';
import { generateFixtureLab, loadFixtureLab } from './fixture-factory.mjs';
import { aggregateMetrics, runBenchmarkCase } from './evaluate.mjs';
import { assertSafety, buildReport, writeReport } from './report.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultRoot = process.env.AX_TEST_ROOT ?? 'D:\\ax\\_test';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function parseArgs(argv) {
  const options = {
    root: defaultRoot,
    seed: process.env.AX_WD_BENCHMARK_SEED ?? 'wd-v1',
    profile: process.env.AX_WD_BENCHMARK_PROFILE ?? 'v1',
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
    else if (argument === '--seed') options.seed = argv[++index] ?? options.seed;
    else if (argument === '--profile') options.profile = argv[++index] ?? options.profile;
    else throw new Error(`unknown_argument:${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`Work Discovery Benchmark v1

Usage:
  npm run test:wd-benchmark -- --check-contract
  npm run test:wd-benchmark -- --generate --report
  npm run test:wd-benchmark -- --profile rotating --generate --report
  npm run test:wd-benchmark -- --root D:\\ax\\_test --verify-safety

Options:
  --root <path>       external test-lab root (default: D:\\ax\\_test)
  --seed <value>      deterministic fixture seed
  --profile <name>    fixture profile: v1, rotating, schema-drift, source-confusion, holdout, input-variation, or expanded (default: v1)
  --generate          create/update owned fixture files
  --report            write JSON and Markdown reports under runs/
  --verify-safety     fail unless Full preserves all safe outcomes
  --check-contract    validate the benchmark case contract without building
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

function printSummary(report) {
  console.log(`\n[wd-benchmark] seed=${report.seed} cases=${report.cases.length}`);
  for (const [variant, metrics] of Object.entries(report.metrics)) {
    console.log(`[wd-benchmark] ${variant} correctPublish=${metrics.correctPublishRate ?? '-'} falsePublish=${metrics.falsePublishRate ?? '-'} safeDecision=${metrics.safeDecisionRate ?? '-'} holdout=${metrics.holdoutOutputAccuracy ?? '-'}`);
  }
  console.log(`[wd-benchmark] Full unsafe publishes=${report.safety.fullUnsafePublishes} safe-outcome failures=${report.safety.fullSafeOutcomeFailures}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.checkContract) {
    const result = validateCatalog(
      buildCatalogForProfile(options.seed, options.profile),
      expectedCaseCount(options.profile),
      requiredCaseIds(options.profile),
    );
    console.log(`[wd-benchmark] contract PASS profile=${options.profile} cases=${result.caseCount}`);
    return;
  }

  if (options.generate) {
    const generated = await generateFixtureLab(options.root, options.seed, options.profile);
    console.log(`[wd-benchmark] generated profile=${options.profile} ${generated.cases.length} cases at ${generated.benchmarkRoot}`);
  }

  if (!options.report && !options.verifySafety) return;

  ensureCoreBuild(options.skipBuild);
  const lab = await loadFixtureLab(options.root);
  const core = await loadCoreAdapter(repoRoot);
  const cases = lab.cases.map((item) => runBenchmarkCase(item, core));
  const report = buildReport({
    root: lab.root,
    manifest: lab.manifest,
    cases,
    metrics: aggregateMetrics(cases),
    generatedAt: new Date().toISOString(),
  });
  printSummary(report);
  if (options.report || options.verifySafety) {
    const paths = await writeReport(lab.root, report);
    console.log(`[wd-benchmark] report=${paths.markdownPath}`);
  }
  if (options.verifySafety) assertSafety(report);
}

main().catch((error) => {
  console.error(`[wd-benchmark] ${error.message}`);
  process.exitCode = 1;
});
