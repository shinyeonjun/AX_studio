import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('npm run verify:release [-- --package]\nRuns local release checks; --package also builds and tests the Windows installer payload. No publishing or real provider calls.');
  process.exit(0);
}
if (args.some((arg) => arg !== '--package')) throw new Error('Only --package is supported');
if (args.includes('--package') && process.platform !== 'win32') throw new Error('--package requires Windows');

const env = { ...process.env };
// The release gate must never open a developer/customer profile or copy credentials.
for (const key of Object.keys(env)) {
  if (key === 'AX_DATA_ROOT' || key === 'AX_DB_BACKEND' || key === 'AX_PRODUCT_QA' || key === 'AX_LIVE_DISCOVERY_MODEL' ||
    key.startsWith('AX_PRODUCT_QA_') || key.startsWith('AX_E2E')) delete env[key];
}
const checks = [
  ['Runtime and build dependency security', 'audit', '--audit-level=low'],
  ['Production build', 'run', 'build'],
  ['Core regression tests', 'run', 'test', '-w', '@ax-studio/core', '--', '--reporter=dot', '--silent'],
  ['Webhook fixture security', 'run', 'test:manual:webhook:security'],
  ['Desktop regression tests', 'run', 'test', '-w', '@ax-studio/desktop', '--', '--reporter=dot', '--silent'],
  ['Desktop type check', 'run', 'typecheck:desktop'],
  ['Document engine tests', 'run', 'test:document-engine'],
  ['Core evaluation', 'run', 'eval'],
  ['Architecture boundaries', 'run', 'arch:check'],
  ['Unused code and dependencies', 'run', 'knip'],
];
function run(label, command, commandArgs, overrides = {}) {
  console.log(`\n[release] ${label}`);
  const started = performance.now();
  const result = spawnSync(command, commandArgs, {
    cwd: root, env: { ...env, ...overrides }, stdio: 'inherit', windowsHide: true,
    shell: process.platform === 'win32' && command === 'npm',
  });
  if (result.error || result.status !== 0) {
    console.error(`[release] FAILED: ${label}`, result.error?.message ?? result.signal ?? result.status);
    process.exit(result.status || 1);
  }
  console.log(`[release] PASS: ${label} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
}
for (const [label, ...commandArgs] of checks) run(label, 'npm', commandArgs);
run('Real HTTP, concurrent approvals and process-kill recovery', process.execPath, ['--test', 'test/release/reliability.test.mjs']);
const reportRoot = mkdtempSync(join(tmpdir(), 'ax-release-report-'));
console.log(`[release] PDF report artifacts: ${reportRoot}`);
run('Real PDF worker and independent output verification', process.execPath, ['test/report-generation-e2e/run.mjs', `--root=${reportRoot}`]);
run('Full deterministic Electron product QA', 'npm', ['run', 'test:product-qa', '--', '--mode', 'deterministic', '--tier', 'full', '--strict', '--isolated-data', '--skip-build']);
if (args.includes('--package')) {
  run('Windows package, archive integrity and isolated document engine', 'npm', ['run', 'pack:win', '-w', '@ax-studio/desktop']);
  const executable = join(root, 'apps/desktop/release/win-unpacked/AX Studio.exe');
  const { version } = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
  run('Windows product identity and version resources', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'test/release/package-metadata.ps1', '-Executable', executable,
    '-Installer', join(root, `apps/desktop/release/AX Studio Setup ${version}.exe`)]);
  const acceptanceRoot = mkdtempSync(join(tmpdir(), 'ax-release-startup-'));
  console.log(`[release] Real-startup evidence: ${acceptanceRoot}`);
  for (const scenario of ['migration', 'credential-recovery']) {
    const acceptanceArgs = ['test/release/installed-app.mjs', '--executable', executable,
      '--workspace', join(acceptanceRoot, scenario), '--version', version];
    run(`Real packaged startup: ${scenario}`, process.execPath,
      [...acceptanceArgs, ...(scenario === 'credential-recovery' ? ['--corrupt-credential'] : [])]);
    run(`Real packaged restart: ${scenario}`, process.execPath, [...acceptanceArgs, '--reopen']);
  }
  run('Packaged Electron restart and approval retention', process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--config', 'test/product-qa/playwright.config.ts', 'release-lifecycle.spec.ts'],
    { AX_PRODUCT_QA_MODE: 'deterministic', AX_PRODUCT_QA_ISOLATED: '1',
      AX_PRODUCT_QA_EXECUTABLE: executable });
}
run('Diff whitespace', 'git', ['diff', '--check']);
console.log('\n[release] All requested local gates passed. Fresh-machine installation and distribution/license review remain separate; disclose unverified live-provider paths. Code signing is optional for GitHub Releases. Nothing was published.');
