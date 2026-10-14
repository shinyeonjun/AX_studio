// Case-level summary of the v4 holdout runs: node scripts/decision-compare-v4-cases.mjs <v4-runs-dir> [out.json]
// Case accuracy is 2 of 3 runs; a failed judgment is split into a wrong read or route (expected a
// command, ran another), an execution where asking was expected, an ask, or a decline. The API
// estimate subtracts the CLI fixed overhead (overhead-*.json) from every call: an estimate, not a measurement.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir, outPath] = process.argv.slice(2);
const RUN = /^(.+)-run(\d+)\.h4\.json$/u;
const PRICES = {
  'jev-1.13.0': { input: 0.042, cached: 0.042, output: 0 },
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
  'gpt-6.1-sol': { input: 2, cached: 0.1, output: 10 },
};
const cost = (c, minusInput = 0) => {
  const p = PRICES[c.model]; if (!p) return 0;
  const input = Math.max(0, (c.inputTokens ?? 0) - minusInput);
  const cached = Math.min(c.cachedInputTokens ?? 0, input);
  return ((input - cached) * p.input + cached * p.cached + (c.outputTokens ?? 0) * p.output) / 1e6;
};
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function loadArm(dir, takes, name) {
  const runs = [];
  for (const file of readdirSync(dir).filter((f) => RUN.test(f) && takes(RUN.exec(f)[1])).sort()) {
    const run = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const retryFile = join(dir, file.replace(/\.json$/u, '-retry.json'));
    const retry = existsSync(retryFile) ? JSON.parse(readFileSync(retryFile, 'utf8')) : undefined;
    const byId = new Map((retry?.outcomes ?? []).map((o) => [o.id, o]));
    runs.push(run.outcomes.map((o) => (o.serviceError && byId.has(o.id) ? byId.get(o.id) : o)));
  }
  return { name, runs };
}

// The place-fact arm sits beside the LLM runs (same commit); the older Jev arms are in jev-<arm>/.
const arms = [];
for (const arm of ['original', 'orders-fix', 'redesign', 'control']) arms.push(loadArm(join(dir, `jev-${arm}`), () => true, `jev ${arm}`));
arms.push(loadArm(dir, (prefix) => prefix === 'jev', 'jev place-fact'));
const llmEngines = [...new Set(readdirSync(dir).filter((f) => RUN.test(f)).map((f) => RUN.exec(f)[1]).filter((p) => p !== 'jev'))].sort();
for (const engine of llmEngines) arms.push(loadArm(dir, (prefix) => prefix === engine, engine));
const overhead = Object.fromEntries(readdirSync(dir).filter((f) => f.startsWith('overhead-')).map((f) => {
  const { engine, records } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return [engine.replace(/^codex:/u, '').replace(/:/gu, '_'), { inputTokens: mean(records.map((r) => r.inputTokens)), durationMs: pct(records.map((r) => r.durationMs), 0.5) }];
}));

// How a failed outcome failed.
const failKind = (o) => {
  if (o.passed) return 'pass';
  if (o.serviceError) return 'service';
  if (o.kind === 'command') {
    const expectsCommand = o.expected.kind.includes('command');
    return expectsCommand ? 'wrong_target' : 'over_execute';
  }
  if (o.kind === 'clarify' || o.kind === 'parameterized') return 'asked';
  return 'declined';
};

const caseIds = arms[0].runs[0].map((o) => o.id);
const caseMeta = new Map(arms[0].runs[0].map((o) => [o.id, { message: o.message, expected: o.expected, workspace: o.workspace }]));
const summary = arms.map((arm) => {
  const all = arm.runs.flat();
  const perCase = Object.fromEntries(caseIds.map((id) => {
    const os = arm.runs.map((r) => r.find((o) => o.id === id));
    return [id, { passes: os.filter((o) => o.passed).length, got: os.map((o) => (o.passed ? 'ok' : `${failKind(o)}:${o.kind}/${o.route ?? ''}${o.decided ? `/${o.decided.id}${o.decided.params?.table ? `:${o.decided.params.connectionId ?? ''}.${o.decided.params.table}` : ''}${o.decided.params?.path ? `:${o.decided.params.connectionId ?? ''}/${o.decided.params.path}` : ''}` : ''}`)) }];
  }));
  const counts = {};
  for (const o of all) { const k = failKind(o); counts[k] = (counts[k] ?? 0) + 1; }
  const engine = arm.name.replace(/^(codex|holistic)_/u, '');
  const oh = overhead[engine];
  const apiEstimate = oh && arm.name.startsWith('codex_') || oh && arm.name.startsWith('holistic_') ? (() => {
    const perCaseCost = all.map((o) => o.calls.reduce((s, c) => s + cost(c, oh.inputTokens), 0));
    const perCaseMs = all.map((o) => Math.max(0, o.durationMs - o.calls.length * oh.durationMs));
    return { overhead: oh, per1000Usd: mean(perCaseCost) * 1000, p50Ms: pct(perCaseMs, 0.5), p95Ms: pct(perCaseMs, 0.95) };
  })() : undefined;
  const withFailedCall = all.filter((o) => o.calls.some((c) => c.error));
  const clean = all.filter((o) => !o.calls.some((c) => c.error));
  return {
    arm: arm.name,
    runs: arm.runs.length,
    runAccuracy: arm.runs.map((r) => r.filter((o) => o.passed).length / r.length),
    caseAccuracy2of3: caseIds.filter((id) => perCase[id].passes >= 2).length / caseIds.length,
    casesPassed2of3: caseIds.filter((id) => perCase[id].passes >= 2).length,
    judgments: all.length,
    counts,
    latency: { p50: pct(all.map((o) => o.durationMs), 0.5), p95: pct(all.map((o) => o.durationMs), 0.95), casesWithFailedCall: withFailedCall.length, cleanP50: pct(clean.map((o) => o.durationMs), 0.5), cleanP95: pct(clean.map((o) => o.durationMs), 0.95) },
    cost1000: mean(all.map((o) => o.calls.reduce((s, c) => s + cost(c), 0))) * 1000,
    apiEstimate,
    perCase,
  };
});

// McNemar exact on 2-of-3 case verdicts.
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i; return r; };
const mcnemar = (b, c) => { const n = b + c; if (!n) return 1; const k = Math.min(b, c); let p = 0; for (let i = 0; i <= k; i += 1) p += binom(n, i); return Math.min(1, (2 * p) / 2 ** n); };
const pass = (s, id) => s.perCase[id].passes >= 2;
const pf = summary.find((s) => s.arm === 'jev place-fact');
const pairs = summary.filter((s) => s !== pf).map((s) => {
  const onlyJev = caseIds.filter((id) => pass(pf, id) && !pass(s, id));
  const onlyOther = caseIds.filter((id) => !pass(pf, id) && pass(s, id));
  return { other: s.arm, bothPass: caseIds.filter((id) => pass(pf, id) && pass(s, id)).length, onlyJev, onlyOther, bothFail: caseIds.filter((id) => !pass(pf, id) && !pass(s, id)), p: mcnemar(onlyJev.length, onlyOther.length) };
});

// Cases any arm missed (2 of 3 or worse, or not unanimous).
const missed = caseIds.filter((id) => summary.some((s) => s.perCase[id].passes < 3));
const caseTable = missed.map((id) => ({ id, ...caseMeta.get(id), byArm: Object.fromEntries(summary.map((s) => [s.arm, s.perCase[id]])) }));

if (outPath) writeFileSync(outPath, JSON.stringify({ summary: summary.map(({ perCase, ...rest }) => rest), pairs, caseTable }, null, 2));

const f = (x) => (x * 100).toFixed(1);
console.log('| arm | case acc (2/3) | run acc | wrong target | over-execute | asked | declined | service | p50 | p95 | $/1000 |');
for (const s of summary) console.log(`| ${s.arm} | ${f(s.caseAccuracy2of3)}% (${s.casesPassed2of3}/76) | ${s.runAccuracy.map(f).join('/')} | ${s.counts.wrong_target ?? 0} | ${s.counts.over_execute ?? 0} | ${s.counts.asked ?? 0} | ${s.counts.declined ?? 0} | ${s.counts.service ?? 0} | ${(s.latency.p50 / 1000).toFixed(2)} | ${(s.latency.p95 / 1000).toFixed(2)} | ${s.cost1000.toFixed(3)} |`);
console.log('\nlatency excluding cases with a failed (429) call');
for (const s of summary) if (s.latency.casesWithFailedCall) console.log(s.arm, s.latency.casesWithFailedCall, 'cases;', (s.latency.cleanP50 / 1000).toFixed(2), (s.latency.cleanP95 / 1000).toFixed(2));
console.log('\nAPI estimate (overhead subtracted per call)');
for (const s of summary) if (s.apiEstimate) console.log(s.arm, JSON.stringify(s.apiEstimate));
console.log('\n| place-fact vs | both pass | only Jev | only other | both fail | p |');
for (const p of pairs) console.log(`| ${p.other} | ${p.bothPass} | ${p.onlyJev.length} ${p.onlyJev.join(',')} | ${p.onlyOther.length} ${p.onlyOther.join(',')} | ${p.bothFail.length} ${p.bothFail.join(',')} | ${p.p.toFixed(4)} |`);
console.log('\ncases not 3/3 in some arm:', missed.length);
for (const c of caseTable) {
  console.log(`\n${c.id} [${c.workspace}] "${c.message}" expect ${JSON.stringify(c.expected)}`);
  for (const [arm, v] of Object.entries(c.byArm)) if (v.passes < 3) console.log(`   ${arm}: ${v.passes}/3  ${v.got.filter((g) => g !== 'ok').join(' | ')}`);
}
