import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport } from './metrics.js';
import { coverageFor } from './scenario-loader.js';
import type { ProductQaReport } from './types.js';

export function writeReport(report: ProductQaReport, artifactDir: string, workerId = String(process.pid)): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(workerId)) throw new Error('Invalid QA worker identifier');
  mkdirSync(join(artifactDir, 'screenshots'), { recursive: true });
  // Playwright replaces a worker after a failure, even with retries disabled.
  // Keep each worker's cumulative snapshot so its failures cannot be overwritten
  // by the next worker's initially empty in-memory result list. QA uses workers: 1.
  const partsDir = join(artifactDir, 'report-parts');
  mkdirSync(partsDir, { recursive: true });
  writeFileSync(join(partsDir, `${workerId}.json`), JSON.stringify(report), 'utf8');
  const parts = readdirSync(partsDir).filter((name) => name.endsWith('.json')).sort()
    .map((name) => JSON.parse(readFileSync(join(partsDir, name), 'utf8')) as ProductQaReport)
    .filter((part) => part.runId === report.runId);
  const scenarios = parts.flatMap((part) => part.scenarios);
  const aggregate = buildReport({
    ...report,
    startedAt: parts.map((part) => part.startedAt).sort()[0] ?? report.startedAt,
    scenarios,
    replyLatenciesMs: parts.flatMap((part) => part.replyLatenciesMs ?? []),
    coverage: coverageFor(scenarios.filter((scenario) => scenario.passed)),
  });
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(aggregate, null, 2), 'utf8');
  writeFileSync(join(artifactDir, 'report.md'), renderMarkdown(aggregate), 'utf8');
}

function renderMarkdown(report: ProductQaReport): string {
  const lines: string[] = [
    '# AX Studio Product QA Report',
    '',
    `- Run: \`${report.runId}\``,
    `- Mode: **${report.mode}**`,
    `- Tier: **${report.tier ?? 'handwritten'}**`,
    `- Data root: \`${report.dataRoot}\``,
    `- Strict: ${report.strict ? 'yes' : 'no'}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Scenario runs | ${report.summary.scenarioRuns} |`,
    `| Passed | ${report.summary.passed} |`,
    `| Failed | ${report.summary.failed} |`,
    `| Defects | ${report.summary.defects} |`,
    `| Critical defects | ${report.summary.criticalDefects} |`,
    `| Median reply (ms) | ${report.summary.medianReplyMs ?? 'n/a'} |`,
    `| P95 reply (ms) | ${report.summary.p95ReplyMs ?? 'n/a'} |`,
    '',
  ];

  if (report.coverage) {
    lines.push(
      '## Coverage',
      '',
      `- Passing scenarios' declared surfaces: ${report.coverage.covered}/${report.coverage.total}`,
      '- This is scenario coverage, not proof of capability correctness. Deterministic mode uses a fake model.',
    );
    if (report.coverage.missing.length > 0) {
      lines.push(`- Missing: ${report.coverage.missing.join(', ')}`);
    }
    lines.push('');
  }

  const defects = report.scenarios.flatMap((s) => s.defects.filter((d) => !d.passed));
  if (defects.length > 0) {
    lines.push('## Defects', '');
    for (const defect of defects) {
      lines.push(
        `### [${defect.severity}] ${defect.scenarioId} — ${defect.check}`,
        `- Run #${defect.runIndex + 1}, step ${defect.stepIndex}`,
        `- Expected: ${defect.expected}`,
        `- Actual: ${defect.actual}`,
        '',
      );
    }
  }

  lines.push('## Scenarios', '');
  for (const scenario of report.scenarios) {
    lines.push(
      `### ${scenario.scenarioName} (\`${scenario.scenarioId}\`)`,
      `- Passed: ${scenario.passed ? 'yes' : 'no'}`,
      `- Duration: ${scenario.durationMs}ms`,
      `- Checks: ${scenario.defects.filter((d) => d.passed).length}/${scenario.defects.length} passed`,
      scenario.error ? `- Error: ${scenario.error}` : '',
      '',
    );
  }

  return lines.filter((line) => line !== undefined).join('\n');
}
