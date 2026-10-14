// Summarizes decision-compare.live.test.ts runs: node scripts/decision-compare-report.mjs <runs-dir> [out.json]
// Prices: official Standard tier, USD per 1M tokens, accessed 2026-10-13 (see docs/evaluation/jev-vs-codex-decision.md).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PRICES = {
  'jev-1.13.0': { input: 0.042, cached: 0.042, output: 0 },
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2 },
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5 },
  'gpt-6.1-sol': { input: 2, cached: 0.1, output: 10 },
};

const [dir, outPath] = process.argv.slice(2);
// One run of an engine may be split in parts run on different days: <engine>-run<n>.json holds the
// first cases, <engine>-run<n>.<part>.json the ones added later (AX_COMPARE_PART). Each may have a
// -retry.json beside it.
const RUN_FILE = /^(.+)-run(\d+)(?:\.([a-z0-9]+))?\.json$/u;
const files = readdirSync(dir).filter((file) => RUN_FILE.test(file));
const caseKey = (outcome) => `${outcome.set}/${outcome.workspace}/${outcome.id}`;
// A call that never completed (the provider's own outage, e.g. "Selected model is at capacity") says
// nothing about the decision: its case is taken from the part's -retry.json when one was made. The
// first-attempt numbers stay in the report as the service reliability.
const isServiceFailure = (outcome) => outcome.serviceError || String(outcome.miss ?? '').startsWith('threw');
const parts = files.map((file) => {
  const run = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const [, , runNumber] = RUN_FILE.exec(file);
  let retried;
  try { retried = JSON.parse(readFileSync(join(dir, file.replace(/\.json$/u, '-retry.json')), 'utf8')); } catch { /* none */ }
  const byId = new Map((retried?.outcomes ?? []).map((outcome) => [caseKey(outcome), outcome]));
  return {
    engine: run.engine, runNumber, firstAttempt: run.outcomes,
    outcomes: run.outcomes.map((outcome) => {
      const replacement = isServiceFailure(outcome) ? byId.get(caseKey(outcome)) : undefined;
      return replacement ? { ...replacement, retried: true, firstAttemptCalls: outcome.calls } : outcome;
    }),
  };
});
const runMap = new Map();
for (const part of parts) {
  const key = `${part.engine}#${part.runNumber}`;
  const run = runMap.get(key) ?? { engine: part.engine, runNumber: part.runNumber, outcomes: [], firstAttemptOutcomes: [] };
  run.outcomes.push(...part.outcomes);
  run.firstAttemptOutcomes.push(...part.firstAttempt);
  runMap.set(key, run);
}
const runs = [...runMap.values()];
const firstAttemptRuns = runs.map((run) => ({ engine: run.engine, outcomes: run.firstAttemptOutcomes }));
const firstAttempt = new Map();
for (const run of firstAttemptRuns) {
  const entry = firstAttempt.get(run.engine) ?? { cases: 0, passed: 0, serviceFailures: 0, calls: 0, failedCalls: 0, errors: new Set() };
  entry.cases += run.outcomes.length;
  entry.passed += run.outcomes.filter((outcome) => outcome.passed).length;
  entry.serviceFailures += run.outcomes.filter(isServiceFailure).length;
  for (const call of run.outcomes.flatMap((outcome) => outcome.calls)) {
    entry.calls += 1;
    if (call.error) { entry.failedCalls += 1; entry.errors.add(call.error); }
  }
  firstAttempt.set(run.engine, entry);
}
const overhead = readdirSync(dir).filter((file) => file.startsWith('overhead-')).map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')));

/**
 * 95% Wilson interval for a pass rate over `n` cases. The three runs of a case are not independent
 * draws, so n is the number of cases, not case-runs (p is the mean over runs).
 */
function wilson(p, n) {
  if (!n) return [0, 0];
  const z = 1.96;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Exact two-sided McNemar test: the chance of a split this lopsided if both engines were equal. */
function mcnemar(onlyA, onlyB) {
  const n = onlyA + onlyB;
  if (n === 0) return 1;
  let tail = 0;
  let coefficient = 1;
  for (let k = 0; k <= Math.min(onlyA, onlyB); k += 1) {
    if (k > 0) coefficient = (coefficient * (n - k + 1)) / k;
    tail += coefficient / 2 ** n;
  }
  return Math.min(1, 2 * tail);
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => (values.length ? sum(values) / values.length : 0);
const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
};

/**
 * Cost of one call. Codex reports reasoning tokens inside output_tokens (checked below); OpenAI
 * bills them as output. Cached input is part of input_tokens.
 */
function callCost(call) {
  const price = PRICES[call.model] ?? PRICES[String(call.model).replace(/-\d{4}.*$/u, '')];
  if (!price) return undefined;
  const input = call.inputTokens ?? 0;
  const cached = call.cachedInputTokens ?? 0;
  return ((input - cached) * price.input + cached * price.cached + (call.outputTokens ?? 0) * price.output) / 1e6;
}

const byEngine = new Map();
for (const run of runs) {
  if (!byEngine.has(run.engine)) byEngine.set(run.engine, []);
  byEngine.get(run.engine).push(run);
}

const reasoningAboveOutput = runs.flatMap((run) => run.outcomes.flatMap((outcome) => outcome.calls))
  .filter((call) => (call.reasoningTokens ?? 0) > (call.outputTokens ?? 0)).length;

const engines = [];
for (const [engine, engineRuns] of byEngine) {
  const outcomes = engineRuns.flatMap((run) => run.outcomes.map((outcome) => ({ ...outcome, run: run.at })));
  const accuracy = (filter) => engineRuns.map((run) => {
    const picked = run.outcomes.filter(filter);
    return picked.length ? picked.filter((outcome) => outcome.passed).length / picked.length : 0;
  });
  const sets = {
    all: () => true,
    main: (outcome) => outcome.set === 'main',
    holdout: (outcome) => outcome.set === 'holdout',
    'main/basic': (outcome) => outcome.set === 'main' && outcome.workspace === 'basic',
    'main/scale': (outcome) => outcome.set === 'main' && outcome.workspace === 'scale',
    'holdout/basic': (outcome) => outcome.set === 'holdout' && outcome.workspace === 'basic',
    'holdout/scale': (outcome) => outcome.set === 'holdout' && outcome.workspace === 'scale',
    // The first 24 held-out cases (2026-10-13) and the 76 added by a blind author (2026-10-14).
    'holdout-v1': (outcome) => outcome.set === 'holdout' && !/^h[234]/u.test(outcome.id),
    'holdout-v2': (outcome) => outcome.set === 'holdout' && outcome.id.startsWith('h2'),
    'holdout-v3': (outcome) => outcome.set === 'holdout' && outcome.id.startsWith('h3'),
    'holdout-v4': (outcome) => outcome.set === 'holdout' && outcome.id.startsWith('h4'),
  };
  const accuracyBySet = Object.fromEntries(Object.entries(sets).map(([name, filter]) => {
    const values = accuracy(filter);
    const cases = engineRuns[0].outcomes.filter(filter).length;
    return [name, { mean: mean(values), min: Math.min(...values), max: Math.max(...values), cases, ci95: wilson(mean(values), cases) }];
  }));

  // Same case, every run: does the engine come back with the same verdict and the same decision?
  const caseIds = [...new Set(outcomes.map((outcome) => `${outcome.set}/${outcome.workspace}/${outcome.id}`))];
  const perCase = caseIds.map((key) => {
    const entries = outcomes.filter((outcome) => `${outcome.set}/${outcome.workspace}/${outcome.id}` === key);
    return {
      key,
      passes: entries.filter((entry) => entry.passed).length,
      runs: entries.length,
      sameDecision: new Set(entries.map((entry) => JSON.stringify([entry.kind, entry.route, entry.decided]))).size === 1,
    };
  });
  const failures = outcomes.filter((outcome) => !outcome.passed);
  const calls = outcomes.flatMap((outcome) => outcome.calls);
  const perCaseTokens = (field) => mean(outcomes.map((outcome) => sum(outcome.calls.map((call) => call[field] ?? 0))));
  const costs = outcomes.map((outcome) => sum(outcome.calls.map((call) => callCost(call) ?? 0)));
  engines.push({
    engine,
    runs: engineRuns.length,
    models: [...new Set(calls.map((call) => call.model).filter(Boolean))],
    accuracy: accuracyBySet,
    consistency: {
      sameVerdictAllRuns: perCase.filter((entry) => entry.passes === 0 || entry.passes === entry.runs).length / perCase.length,
      sameDecisionAllRuns: perCase.filter((entry) => entry.sameDecision).length / perCase.length,
      flakyCases: perCase.filter((entry) => entry.passes > 0 && entry.passes < entry.runs).map((entry) => entry.key),
    },
    failures: {
      total: failures.length,
      wrongCommand: failures.filter((outcome) => outcome.kind === 'command').length,
      askedOrDeclined: failures.filter((outcome) => outcome.kind === 'clarify' || (outcome.kind === 'fallback' && !outcome.serviceError) || outcome.kind === 'reply' || outcome.kind === 'previous_result').length,
      serviceError: failures.filter((outcome) => outcome.serviceError || String(outcome.miss).startsWith('threw')).length,
    },
    latencyMs: {
      perCase: { mean: mean(outcomes.map((o) => o.durationMs)), p50: pct(outcomes.map((o) => o.durationMs), 0.5), p95: pct(outcomes.map((o) => o.durationMs), 0.95), max: Math.max(...outcomes.map((o) => o.durationMs)) },
      perCall: { mean: mean(calls.map((c) => c.durationMs)), p50: pct(calls.map((c) => c.durationMs), 0.5), p95: pct(calls.map((c) => c.durationMs), 0.95) },
      perCaseBasic: pct(outcomes.filter((o) => o.workspace === 'basic').map((o) => o.durationMs), 0.5),
      perCaseScale: pct(outcomes.filter((o) => o.workspace === 'scale').map((o) => o.durationMs), 0.5),
    },
    callsPerCase: mean(outcomes.map((outcome) => outcome.calls.length)),
    providerRequestsPerCase: mean(outcomes.map((outcome) => sum(outcome.calls.map((call) => call.providerRequests ?? 1)))),
    tokensPerCase: {
      input: perCaseTokens('inputTokens'),
      cachedInput: perCaseTokens('cachedInputTokens'),
      output: perCaseTokens('outputTokens'),
      reasoning: perCaseTokens('reasoningTokens'),
      requestBytes: perCaseTokens('requestBytes'),
    },
    costUsd: { perCase: mean(costs), per1000Requests: mean(costs) * 1000, allRuns: sum(costs) },
    firstAttempt: (() => {
      const entry = firstAttempt.get(engine);
      return {
        accuracy: entry.passed / entry.cases,
        serviceFailureRate: entry.serviceFailures / entry.cases,
        failedCallRate: entry.failedCalls / entry.calls,
        serviceFailures: entry.serviceFailures,
        errors: [...entry.errors],
      };
    })(),
    retriedCases: outcomes.filter((outcome) => outcome.retried).length,
    stillServiceFailedAfterRetry: outcomes.filter(isServiceFailure).length,
    missedCases: [...new Set(failures.map((outcome) => `${outcome.set}/${outcome.workspace}/${outcome.id}`))],
  });
}

// Which cases each Codex setting got right that Jev did not, and the reverse (majority over runs).
const majority = (engine) => {
  const result = new Map();
  for (const run of byEngine.get(engine) ?? []) {
    for (const outcome of run.outcomes) {
      const key = `${outcome.set}/${outcome.workspace}/${outcome.id}`;
      result.set(key, (result.get(key) ?? 0) + (outcome.passed ? 1 : 0));
    }
  }
  const runsCount = (byEngine.get(engine) ?? []).length;
  return new Map([...result].map(([key, passes]) => [key, passes * 2 > runsCount]));
};
const jev = majority('jev');
const versusJev = [...byEngine.keys()].filter((engine) => engine !== 'jev').map((engine) => {
  const other = majority(engine);
  const paired = (keys) => {
    const onlyJev = keys.filter((key) => jev.get(key) && !other.get(key));
    const onlyEngine = keys.filter((key) => !jev.get(key) && other.get(key));
    return {
      cases: keys.length,
      bothPass: keys.filter((key) => jev.get(key) && other.get(key)).length,
      onlyJev, onlyEngine,
      bothFail: keys.filter((key) => !jev.get(key) && !other.get(key)),
      mcnemarP: mcnemar(onlyJev.length, onlyEngine.length),
    };
  };
  const keys = [...jev.keys()];
  return {
    engine,
    ...paired(keys),
    holdout: paired(keys.filter((key) => key.startsWith('holdout/'))),
  };
});

const overheadSummary = overhead.map(({ engine, records }) => ({
  engine,
  durationMs: { mean: mean(records.map((r) => r.durationMs)), p50: pct(records.map((r) => r.durationMs), 0.5) },
  inputTokens: mean(records.map((r) => r.inputTokens ?? 0)),
  cachedInputTokens: mean(records.map((r) => r.cachedInputTokens ?? 0)),
  outputTokens: mean(records.map((r) => r.outputTokens ?? 0)),
  reasoningTokens: mean(records.map((r) => r.reasoningTokens ?? 0)),
  costUsd: mean(records.map((r) => callCost(r) ?? 0)),
}));

const report = { generatedAt: new Date().toISOString(), prices: PRICES, reasoningAboveOutputCalls: reasoningAboveOutput, engines, versusJev, overhead: overheadSummary };
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));

const f1 = (value) => (value * 100).toFixed(1);
console.log('| engine | runs | all [95% CI] | main | holdout [95% CI] | main/basic | main/scale | holdout/basic | holdout/scale | holdout-v1 | holdout-v2 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const e of engines) {
  const cell = (name) => e.accuracy[name].cases ? `${f1(e.accuracy[name].mean)}% (${f1(e.accuracy[name].min)}–${f1(e.accuracy[name].max)}) [${f1(e.accuracy[name].ci95[0])}–${f1(e.accuracy[name].ci95[1])}] n=${e.accuracy[name].cases}` : '–';
  console.log(`| ${e.engine} | ${e.runs} | ${cell('all')} | ${cell('main')} | ${cell('holdout')} | ${cell('main/basic')} | ${cell('main/scale')} | ${cell('holdout/basic')} | ${cell('holdout/scale')} | ${cell('holdout-v1')} | ${cell('holdout-v2')} |`);
}
console.log('\n| engine | p50 case ms | p95 case ms | mean case ms | calls/case | in tok/case | cached | out tok/case | reasoning | $/1000 req | same decision 3 runs | wrong cmd | asked/declined | service err |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const e of engines) {
  console.log(`| ${e.engine} | ${Math.round(e.latencyMs.perCase.p50)} | ${Math.round(e.latencyMs.perCase.p95)} | ${Math.round(e.latencyMs.perCase.mean)} | ${e.callsPerCase.toFixed(2)} | ${Math.round(e.tokensPerCase.input)} | ${Math.round(e.tokensPerCase.cachedInput)} | ${Math.round(e.tokensPerCase.output)} | ${Math.round(e.tokensPerCase.reasoning)} | ${e.costUsd.per1000Requests.toFixed(3)} | ${f1(e.consistency.sameDecisionAllRuns)}% | ${e.failures.wrongCommand} | ${e.failures.askedOrDeclined} | ${e.failures.serviceError} |`);
}
console.log('\n| engine | first-attempt accuracy | first-attempt service failures | failed calls | retried | still failed |');
console.log('|---|---|---|---|---|---|');
for (const e of engines) {
  console.log(`| ${e.engine} | ${f1(e.firstAttempt.accuracy)}% | ${e.firstAttempt.serviceFailures} (${f1(e.firstAttempt.serviceFailureRate)}%) | ${f1(e.firstAttempt.failedCallRate)}% | ${e.retriedCases} | ${e.stillServiceFailedAfterRetry} |`);
}
console.log(`\nreasoning > output in ${reasoningAboveOutput} calls`);
console.log('\n| vs Jev | set | cases | both pass | only Jev | only engine | both fail | McNemar p |');
console.log('|---|---|---|---|---|---|---|---|');
for (const v of versusJev) {
  for (const [name, pair] of [['all', v], ['holdout', v.holdout]]) console.log(`| ${v.engine} | ${name} | ${pair.cases} | ${pair.bothPass} | ${pair.onlyJev.length} | ${pair.onlyEngine.length} | ${pair.bothFail.length} | ${pair.mcnemarP.toFixed(4)} |`);
}
