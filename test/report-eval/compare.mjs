// Compares each generated report with this month's true report, line by line (order ignored).
// Run after AX_REPORT_EVAL finishes: node test/report-eval/compare.mjs [outDir]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const venv = join(here, '..', '..', 'packages', 'document-engine', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venv) ? venv : 'python';
const out = resolve(process.argv[2] ?? 'D:/AX_eval');

function lines(file) {
  const run = spawnSync(python, [join(here, 'extract.py'), file], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout);
}

// Spacing differs between a drawn PDF and one filled in place; the words and numbers must not.
const key = (line) => line.replace(/\s+/g, '');

function difference(left, right) {
  const pool = new Map();
  for (const line of right) pool.set(key(line), (pool.get(key(line)) ?? 0) + 1);
  return left.filter((line) => {
    const left = pool.get(key(line)) ?? 0;
    if (left === 0) return true;
    pool.set(key(line), left - 1);
    return false;
  });
}

const cases = JSON.parse(readFileSync(join(out, 'cases.json'), 'utf8'));
const results = JSON.parse(readFileSync(join(out, 'results', 'results.json'), 'utf8'));
const summary = [];
for (const item of cases) {
  const result = results.find((entry) => entry.id === item.id);
  if (!result) { summary.push({ id: item.id, verdict: 'not_run' }); continue; }
  if (!result.output) {
    // The step's own failure is generic; the report stage that stopped it names the cause.
    const log = result.log ?? [];
    const failure = [...log].reverse().find((entry) => entry.code && entry.code !== 'step_failed'
      && /failed|error|invalid|unsupported|no_progress|insufficient|ambiguous|exceeded/.test(entry.code));
    const replay = [...log].reverse().find((entry) => entry.code === 'report_example_replay_failed' && entry.data?.mismatches);
    summary.push({ id: item.id, verdict: 'no_output', status: result.status, failure: failure?.code,
      message: failure?.data?.phase ? `${failure.data.phase}` : undefined,
      missing: (replay?.data?.mismatches ?? []).slice(0, 4).map((entry) => `${entry.expected}  ←  ${entry.actual}`) });
    continue;
  }
  const expected = lines(item.expected);
  const actual = lines(result.output);
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  summary.push({ id: item.id, verdict: missing.length || extra.length ? 'mismatch' : 'exact', minutes: Math.round(result.durationMs / 6000) / 10, missing, extra });
}
writeFileSync(join(out, 'results', 'summary.json'), JSON.stringify(summary, null, 2));
for (const entry of summary) {
  console.log(`${entry.verdict.padEnd(9)} ${entry.id}${entry.minutes ? ` (${entry.minutes}분)` : ''}${entry.failure ? ` ${entry.failure}: ${entry.message}` : ''}`);
  for (const line of entry.missing ?? []) console.log(`   - ${line}`);
  for (const line of entry.extra ?? []) console.log(`   + ${line}`);
}
