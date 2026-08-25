import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductQaReport } from './types.js';

export function writeReport(report: ProductQaReport, artifactDir: string): void {
  mkdirSync(join(artifactDir, 'screenshots'), { recursive: true });
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(join(artifactDir, 'report.md'), renderMarkdown(report), 'utf8');
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
      `- Product-ready surfaces: ${report.coverage.covered}/${report.coverage.total}`,
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
