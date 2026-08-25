import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PRODUCT_SURFACES } from '../catalog/product-surface.js';
import { coverageFor, loadScenarios } from '../lib/scenario-loader.js';
import { closeDesktop, launchDesktop, tempRunId, type DesktopContext } from '../lib/desktop-app.js';
import { runScenario } from '../lib/step-runner.js';
import { buildReport } from '../lib/metrics.js';
import { writeReport } from '../lib/reporter.js';
import type { ProductQaMode, ProductQaTier, ProductScenario, ScenarioRunResult } from '../lib/types.js';

function parseMode(): ProductQaMode {
  const mode = (process.env.AX_PRODUCT_QA_MODE ?? 'live').trim();
  return mode === 'deterministic' ? 'deterministic' : 'live';
}

function parseTier(): ProductQaTier {
  const tier = (process.env.AX_PRODUCT_QA_TIER ?? 'handwritten').trim();
  if (tier === 'smoke' || tier === 'core' || tier === 'full' || tier === 'soak' || tier === 'handwritten') {
    return tier;
  }
  return 'handwritten';
}

function parseRepeat(): number {
  const value = Number.parseInt(process.env.AX_PRODUCT_QA_REPEAT ?? '1', 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(value, 500)) : 1;
}

function parseMax(tier: ProductQaTier): number {
  const value = Number.parseInt(process.env.AX_PRODUCT_QA_MAX ?? '0', 10);
  if (Number.isFinite(value) && value > 0) return value;
  if (tier === 'soak') return 10_000;
  if (tier === 'full') return 2_000;
  if (tier === 'core') return 300;
  return 50;
}

function parseFilters() {
  const ids = process.env.AX_PRODUCT_QA_SCENARIOS?.split(',').map((v) => v.trim()).filter(Boolean);
  const tags = process.env.AX_PRODUCT_QA_TAGS?.split(',').map((v) => v.trim()).filter(Boolean);
  return { ids, tags };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const mode = parseMode();
const tier = parseTier();
const repeat = parseRepeat();
const strict = process.env.AX_PRODUCT_QA_STRICT === '1';
const filters = parseFilters();
const runId = process.env.AX_PRODUCT_QA_RUN_ID ?? tempRunId();
process.env.AX_PRODUCT_QA_RUN_ID = runId;

const scenarios = loadScenarios({
  ids: filters.ids,
  tags: filters.tags,
  mode,
  tier,
  max: parseMax(tier),
  allowSideEffects: process.env.AX_PRODUCT_QA_ALLOW_SIDE_EFFECTS === '1',
  seed: Number.parseInt(process.env.AX_PRODUCT_QA_SEED ?? '20260825', 10),
});

const printMode = process.env.AX_PRODUCT_QA_PRINT?.trim();
const allResults: ScenarioRunResult[] = [];
const allReplyLatencies: number[] = [];
const startedAt = new Date().toISOString();

function persistReport(dataRoot: string, artifactDir: string) {
  const report = buildReport({
    runId,
    mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    dataRoot,
    strict,
    tier,
    scenarios: allResults,
    replyLatenciesMs: allReplyLatencies,
    coverage: coverageFor(scenarios),
  });
  writeReport(report, artifactDir);
}

async function executeScenario(
  ctx: DesktopContext,
  scenario: ProductScenario,
  runIndex: number,
) {
  const { result, replyLatenciesMs } = await runScenario(ctx, scenario, runIndex, strict);
  allResults.push(result);
  allReplyLatencies.push(...replyLatenciesMs);
  persistReport(ctx.dataRoot, ctx.artifactDir);

  if (result.error && (strict || !scenario.generated)) {
    throw new Error(result.error);
  }
  const failedChecks = result.defects.filter((d) => !d.passed);
  if (strict && failedChecks.length > 0) {
    throw new Error(failedChecks.map((d) => `${d.check}: ${d.actual}`).join('; '));
  }
}

if (printMode) {
  test('print product-qa plan', () => {
    if (printMode === 'catalog') {
      for (const surface of PRODUCT_SURFACES) {
        console.log(
          `${surface.id}\t[${surface.productReady ? 'ready' : 'hidden'}]\t${surface.area}\t${surface.sideEffect}\t${surface.title}`,
        );
      }
      const ready = PRODUCT_SURFACES.filter((surface) => surface.productReady).length;
      console.log(`\n# ${PRODUCT_SURFACES.length} surfaces, ${ready} product-ready`);
      return;
    }
    const coverage = coverageFor(scenarios);
    const generatedCount = scenarios.filter((scenario) => scenario.generated).length;
    console.log(
      `mode=${mode} tier=${tier} handwritten=${scenarios.length - generatedCount} generated=${generatedCount} total=${scenarios.length}`,
    );
    console.log(`coverage=${coverage.covered}/${coverage.total} missing=${coverage.missing.length}`);
    if (printMode === 'count') return;
    for (const scenario of scenarios) {
      console.log(
        `${scenario.id}\t[${scenario.mode ?? mode}]\t${scenario.generated ? 'generated' : 'handwritten'}\t${(scenario.tags ?? []).join(',')}\t${scenario.name}`,
      );
    }
  });
} else if (scenarios.length === 0) {
  test('no scenarios matched filters', () => {
    throw new Error(`No scenarios matched mode=${mode} tier=${tier} filters=${JSON.stringify(filters)}`);
  });
} else {
  const handwritten = scenarios.filter((scenario) => !scenario.generated);
  const generated = scenarios.filter((scenario) => scenario.generated);

  for (const scenario of handwritten) {
    for (let runIndex = 0; runIndex < repeat; runIndex += 1) {
      test(`${scenario.id} [${mode}] run ${runIndex + 1}/${repeat}`, async () => {
        test.setTimeout(Math.max(scenario.timeoutMs ?? 300_000, 180_000));
        const ctx = await launchDesktop({
          mode,
          runId,
          scenarioId: scenario.id,
          runIndex,
        });
        mkdirSync(`${ctx.artifactDir}/screenshots`, { recursive: true });
        try {
          await executeScenario(ctx, scenario, runIndex);
        } finally {
          await closeDesktop(ctx);
        }
      });
    }
  }

  const batches = chunk(generated, 20);
  for (const [batchIndex, batch] of batches.entries()) {
    test(`generated batch ${batchIndex + 1}/${batches.length} (${batch.length} scenarios)`, async () => {
      const timeout = batch.reduce((sum, scenario) => sum + (scenario.timeoutMs ?? 60_000), 120_000);
      test.setTimeout(Math.min(timeout, 3_600_000));
      const ctx = await launchDesktop({
        mode,
        runId,
        scenarioId: `generated-batch-${batchIndex}`,
        runIndex: 0,
      });
      mkdirSync(`${ctx.artifactDir}/screenshots`, { recursive: true });
      try {
        for (const scenario of batch) {
          await executeScenario(ctx, scenario, 0);
        }
      } finally {
        await closeDesktop(ctx);
      }
    });
  }
}

