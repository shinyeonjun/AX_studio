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
const files = readdirSync(dir).filter((file) => /-run\d+\.json$/u.test(file));
const firstAttemptRuns = files.map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')));
// A call that never completed (the provider's own outage, e.g. "Selected model is at capacity") says
// nothing about the decision: its case is taken from <run>-retry.json when one was made. The
// first-attempt numbers stay in the report as the service reliability.
const isServiceFailure = (outcome) => outcome.serviceError || String(outcome.miss ?? '').startsWith('threw');
const runs = files.map((file, index) => {
  const run = firstAttemptRuns[index];
  const retryPath = join(dir, file.replace(/\.json$/u, '-retry.json'));
  let retried;
  try { retried = JSON.parse(readFileSync(retryPath, 'utf8')); } catch { return run; }
  const byId = new Map(retried.outcomes.map((outcome) => [`${outcome.set}/${outcome.workspace}/${outcome.id}`, outcome]));
  return {
    ...run,
    outcomes: run.outcomes.map((outcome) => {
      const replacement = isServiceFailure(outcome) ? byId.get(`${outcome.set}/${outcome.workspace}/${outcome.id}`) : undefined;
      return replacement ? { ...replacement, retried: true, firstAttemptCalls: outcome.calls } : outcome;
    }),
  };
});
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
  };
  const accuracyBySet = Object.fromEntries(Object.entries(sets).map(([name, filter]) => {
    const values = accuracy(filter);
    return [name, { mean: mean(values), min: Math.min(...values), max: Math.max(...values), cases: engineRuns[0].outcomes.filter(filter).length }];
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
  const keys = [...jev.keys()];
  return {
    engine,
    bothPass: keys.filter((key) => jev.get(key) && other.get(key)).length,
    onlyJev: keys.filter((key) => jev.get(key) && !other.get(key)),
    onlyEngine: keys.filter((key) => !jev.get(key) && other.get(key)),
    bothFail: keys.filter((key) => !jev.get(key) && !other.get(key)),
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
console.log('| engine | runs | all | main | holdout | main/basic | main/scale | holdout/basic | holdout/scale |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const e of engines) {
  const cell = (name) => `${f1(e.accuracy[name].mean)}% (${f1(e.accuracy[name].min)}–${f1(e.accuracy[name].max)})`;
  console.log(`| ${e.engine} | ${e.runs} | ${cell('all')} | ${cell('main')} | ${cell('holdout')} | ${cell('main/basic')} | ${cell('main/scale')} | ${cell('holdout/basic')} | ${cell('holdout/scale')} |`);
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
console.log(JSON.stringify(versusJev.map((v) => ({ engine: v.engine, bothPass: v.bothPass, onlyJev: v.onlyJev.length, onlyEngine: v.onlyEngine.length, bothFail: v.bothFail.length }))));
