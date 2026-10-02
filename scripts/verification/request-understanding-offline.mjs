import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const core = join(root, 'packages/core');
const evidenceRoot = join(root, 'build-evidence/jev-request-understanding');
const scratchRoot = join(evidenceRoot, 'scratch');
mkdirSync(scratchRoot, { recursive: true });
const reportPath = join(evidenceRoot, 'vitest.json');
const observationsPath = join(scratchRoot, 'request-understanding-observations.json');
const testPath = 'src/intelligence/agent/commands/chat/request-understanding.offline.test.ts';
const run = spawnSync(process.execPath, [join(core, 'node_modules/vitest/vitest.mjs'), 'run', testPath,
  '--maxWorkers=1', '--configLoader=native', '--reporter=json', `--outputFile=${reportPath}`], {
  cwd: core, encoding: 'utf8', timeout: 120_000,
  env: { ...process.env, AX_DATA_ROOT: scratchRoot, AX_DB_BACKEND: 'sqljs', AX_JEV_OFFLINE_EVIDENCE: '1' },
});
if (run.status !== 0) {
  process.stderr.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  if (run.error) process.stderr.write(`${run.error.message}\n`);
  process.exit(run.status ?? 1);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const observations = JSON.parse(readFileSync(observationsPath, 'utf8')).sort((left, right) => left.id.localeCompare(right.id));
const fixturePath = join(core, 'src/intelligence/agent/commands/chat/request-understanding-cases.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
if (observations.length !== 24 || new Set(observations.map(item => item.id)).size !== 24
  || observations.some(item => item.failures.length > 0) || !report.success) {
  throw new Error('Offline gate requires exactly 24 passing useful and safe cases.');
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const summary = {
  baseCommit: 'ab46777e0ab76d55980faffcb702b0f93223058e', node: process.version,
  kind: 'synthetic contract and chat/service integration validation',
  modelQualityMeasured: false, liveProviderCalls: 0, liveCallLedger: '27/30 unchanged',
  fixtureSha256: sha256(readFileSync(fixturePath)), cases: observations.length,
  passed: observations.filter(item => item.failures.length === 0).length,
  forbiddenCalls: observations.reduce((sum, item) => sum + Object.values(item.observation.forbiddenCalls).reduce((subtotal, count) => subtotal + count, 0), 0),
  generatedModelCalls: observations.reduce((sum, item) => sum + item.observation.generatedProse, 0),
  observations: observations.map(item => ({ ...item, expectations: fixtures.find(fixture => fixture.id === item.id) })),
  limitations: ['Scripted choices do not measure Korean semantics or calibrated accuracy.',
    'No Desktop callsite or broader read-controller integration is enabled.',
    'Concrete fixture labels and exact code await parent review before publication.',
    'Provider transport dispatch counts/costs require a separately authorized live study.'],
};
const summaryPath = join(evidenceRoot, 'summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
process.stdout.write(`${summary.passed}/${summary.cases} offline cases passed; ${summary.forbiddenCalls} forbidden calls; ${summary.generatedModelCalls} generated-model calls.\n${summaryPath}\n`);
