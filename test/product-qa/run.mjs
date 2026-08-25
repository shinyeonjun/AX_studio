#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const productQaDir = join(root, 'test/product-qa');

function printHelp() {
  console.log(`AX Studio Product QA

Usage:
  node test/product-qa/run.mjs [options]

Options:
  --mode live|deterministic   default: live (real AI + real data)
  --tier handwritten|smoke|core|full|soak
                              handwritten = 수동 JSON만
                              smoke = 화면 탐색
                              core = 구현된 capability/command를 제품이 할 수 있는지
                              full = 실제 사용 경로 조합
                              soak = 무작위 수천~수만 ( --max )
  --max <n>                   generated 상한 (soak 기본 10000)
  --allow-side-effects        메일/슬랙 전송·워크플로 저장 시나리오 포함
  --scenario <id>             repeatable; filters scenario id
  --tag <name>                repeatable; filters scenario tag
  --repeat <n>                run each handwritten scenario n times
  --strict                    fail on check defects (default: record only)
  --isolated-data             use isolated AX_DATA_ROOT under runs/
  --shared-data               use real AXStudio data (default for live mode)
  --skip-build                do not build desktop before run
  --list                      print resolved scenarios (includes generated)
  --list-catalog              print implemented product surfaces
  --count                     print scenario/coverage counts
  -h, --help

Examples:
  npm run test:product-qa -- --list-catalog
  npm run test:product-qa -- --mode deterministic --tier smoke
  npm run test:product-qa -- --mode deterministic --tier soak --max 2000
  npm run test:product-qa -- --tier core
  npm run test:product-qa -- --scenario session-isolation-new-chat-while-sending
`);
}

function parseArgs(argv) {
  const options = {
    mode: 'live',
    tier: 'handwritten',
    max: undefined,
    allowSideEffects: false,
    scenarios: [],
    tags: [],
    repeat: 1,
    strict: false,
    isolatedData: undefined,
    skipBuild: false,
    list: false,
    listCatalog: false,
    count: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--list-catalog') options.listCatalog = true;
    else if (arg === '--count') options.count = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--allow-side-effects') options.allowSideEffects = true;
    else if (arg === '--isolated-data') options.isolatedData = true;
    else if (arg === '--shared-data') options.isolatedData = false;
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--mode') options.mode = argv[++i] ?? 'live';
    else if (arg === '--tier') options.tier = argv[++i] ?? 'handwritten';
    else if (arg === '--max') options.max = argv[++i];
    else if (arg === '--scenario') options.scenarios.push(argv[++i] ?? '');
    else if (arg === '--tag') options.tags.push(argv[++i] ?? '');
    else if (arg === '--repeat') options.repeat = Number.parseInt(argv[++i] ?? '1', 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function finalizeOptions(options) {
  if (options.isolatedData === undefined) {
    options.isolatedData = options.mode === 'deterministic';
  }
  return options;
}

function ensureDesktopBuild(skipBuild) {
  const mainOut = join(root, 'apps/desktop/out/main/index.js');
  if (skipBuild && existsSync(mainOut)) return;
  console.log('[product-qa] building desktop...');
  const build = spawnSync('npm', ['run', 'build', '-w', '@ax-studio/desktop'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

function runPlan(options, extraArgs) {
  const env = {
    ...process.env,
    AX_PRODUCT_QA_MODE: options.mode,
    AX_PRODUCT_QA_TIER: options.tier,
    AX_PRODUCT_QA_ALLOW_SIDE_EFFECTS: options.allowSideEffects ? '1' : '0',
    AX_PRODUCT_QA_PRINT: extraArgs.includes('--catalog')
      ? 'catalog'
      : extraArgs.includes('--count')
        ? 'count'
        : 'list',
  };
  if (options.max) env.AX_PRODUCT_QA_MAX = String(options.max);
  const result = spawnSync(
    'npx',
    ['playwright', 'test', '--config', join(productQaDir, 'playwright.config.ts'), '--reporter=line'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env,
    },
  );
  process.exit(result.status ?? 1);
}

const options = finalizeOptions(parseArgs(process.argv.slice(2)));
if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.listCatalog) runPlan(options, ['--catalog']);
if (options.count) runPlan(options, ['--count']);
if (options.list) runPlan(options, []);

ensureDesktopBuild(options.skipBuild);

const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const env = {
  ...process.env,
  AX_PRODUCT_QA_MODE: options.mode,
  AX_PRODUCT_QA_RUN_ID: runId,
  AX_PRODUCT_QA_REPEAT: String(options.repeat),
  AX_PRODUCT_QA_STRICT: options.strict ? '1' : '0',
  AX_PRODUCT_QA_ISOLATED: options.isolatedData ? '1' : '0',
  AX_PRODUCT_QA_TIER: options.tier,
  AX_PRODUCT_QA_ALLOW_SIDE_EFFECTS: options.allowSideEffects ? '1' : '0',
};
if (options.max) env.AX_PRODUCT_QA_MAX = String(options.max);
if (options.scenarios.length > 0) env.AX_PRODUCT_QA_SCENARIOS = options.scenarios.join(',');
if (options.tags.length > 0) env.AX_PRODUCT_QA_TAGS = options.tags.join(',');

console.log(`[product-qa] runId=${runId} mode=${options.mode} tier=${options.tier} repeat=${options.repeat} strict=${options.strict}`);

const result = spawnSync(
  'npx',
  ['playwright', 'test', '--config', join(productQaDir, 'playwright.config.ts')],
  {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  },
);

console.log(`[product-qa] artifacts: test/product-qa/runs/${runId}`);
process.exit(result.status ?? 1);
