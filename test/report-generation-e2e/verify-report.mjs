import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CASES, caseById } from './cases.mjs';
import { extractPdfText, verifyPdf } from './run.mjs';

const repositoryRoot = resolve(new URL('../..', import.meta.url).pathname);
const defaultRoot = process.platform === 'win32'
  ? 'D:\\ax\\_test\\report-generation-e2e'
  : join(process.env.TEMP ?? '/tmp', 'ax-report-generation-e2e');
const reportArgument = process.argv.find(value => value.startsWith('--report='));
const reportPath = resolve(reportArgument?.slice('--report='.length)
  ?? process.env.AX_REPORT_E2E_REPORT
  ?? join(defaultRoot, 'latest.json'));

function fail(message) {
  throw new Error('report_e2e_verification_failed:' + message);
}

function percentile(values, p) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

if (!existsSync(reportPath)) fail('missing_report:' + reportPath);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (report.schemaVersion !== 1 || !Array.isArray(report.cases) || !report.metrics) fail('invalid_shape');
if (report.cases.length !== CASES.length) fail('case_count:' + report.cases.length);
if (resolve(report.root).startsWith(resolve(process.cwd()))) fail('output_inside_repository');

const positive = [];
const negative = [];
for (const item of report.cases) {
  const expected = caseById(item.id);
  if (!expected) fail('unknown_case:' + item.id);
  if (item.expectedOutcome !== expected.expectedOutcome) fail('outcome_contract:' + item.id);
  if (item.category !== expected.category || item.goal !== expected.goal) fail('case_metadata:' + item.id);
  if (expected.expectedOutcome === 'success') {
    positive.push(item);
    if (!item.passed || !item.ok || !item.artifactPath || !existsSync(item.artifactPath)) fail('success_case:' + item.id);
    const verification = verifyPdf(expected, extractPdfText(item.artifactPath));
    if (!verification.ok) fail('pdf_geometry_and_values:' + item.id + ':' + JSON.stringify(verification));
    if (item.httpRequestCount < 3 || item.rdbQueryPages < 2) fail('source_pagination:' + item.id);
    if (item.replayPass !== true) fail('replay:' + item.id);
  } else {
    negative.push(item);
    if (!item.passed || item.ok || item.artifactCount !== 0 || item.artifactPath) fail('safe_failure:' + item.id);
    if (item.errorCode !== expected.expectedErrorCode) fail('failure_code:' + item.id);
  }
}

const metrics = report.metrics;
const durations = report.cases.map(item => item.durationMs);
const positiveDurations = positive.map(item => item.durationMs);
const negativeDurations = negative.map(item => item.durationMs);
const successfulCount = positive.filter(item => item.ok).length;
const passedCount = report.cases.filter(item => item.passed).length;
if (metrics.caseCount !== CASES.length || metrics.passedCaseCount !== passedCount) fail('metric_case_count');
if (metrics.successfulCaseCount !== successfulCount) fail('metric_success_count');
if (metrics.positiveCaseCount !== positive.length || metrics.negativeCaseCount !== negative.length) fail('metric_outcome_count');
if (metrics.safeFailureCaseCount !== negative.filter(item => item.passed).length) fail('metric_failure_count');
if (metrics.e2eSuccessRate !== (successfulCount / positive.length)) fail('metric_success_rate');
if (metrics.safeFailureRate !== 1) fail('metric_safe_failure_rate');
if (metrics.outputCompletenessRate !== 1 || metrics.templateFidelityRate !== 1 || metrics.replayPassRate !== 1) {
  fail('metric_quality_rate');
}
const expectedCategories = [...new Set(CASES.map((item) => item.category))].sort();
if (JSON.stringify(metrics.categories) !== JSON.stringify(expectedCategories)) fail('metric_categories');
if (metrics.latencyMs.p50 !== percentile(durations, 0.5)
  || metrics.latencyMs.p95 !== percentile(durations, 0.95)
  || metrics.latencyMs.p95 < metrics.latencyMs.p50) fail('metric_latency');
if (metrics.positiveLatencyMs.p50 !== percentile(positiveDurations, 0.5)
  || metrics.positiveLatencyMs.p95 !== percentile(positiveDurations, 0.95)
  || metrics.positiveLatencyMs.p95 < metrics.positiveLatencyMs.p50) fail('metric_positive_latency');
if (metrics.safeFailureLatencyMs.p50 !== percentile(negativeDurations, 0.5)
  || metrics.safeFailureLatencyMs.p95 !== percentile(negativeDurations, 0.95)
  || metrics.safeFailureLatencyMs.p95 < metrics.safeFailureLatencyMs.p50) fail('metric_safe_failure_latency');

console.log(JSON.stringify({
  ok: true,
  reportPath,
  cases: report.cases.length,
  verifiedPositive: positive.length,
  verifiedSafeFailures: negative.length,
  e2eSuccessRate: metrics.e2eSuccessRate,
  p50Ms: metrics.latencyMs.p50,
  p95Ms: metrics.latencyMs.p95,
}));
