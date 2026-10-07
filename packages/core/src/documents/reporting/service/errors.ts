import { ReportSourceClarificationRequired } from '../planner/source-discovery.js';

export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error &&
      typeof error.code === 'string' &&
      ['vision_unavailable', 'image_format_unsupported', 'image_input_empty', 'model_output_invalid', 'agent_timeout', 'agent_aborted'].includes(error.code)) {
    return error.code;
  }
  const raw = error instanceof Error ? error.message : String(error);
  const code = raw.split(':', 1)[0] || 'report_generation_failed';
  return /^[a-z][a-z0-9_.-]{0,96}$/i.test(code) ? code : 'report_generation_failed';
}

export function safeErrorData(error: unknown): Record<string, unknown> {
  if (error instanceof ReportSourceClarificationRequired) return { clarification: error.clarification.slice(0, 1000) };
  if (!error || typeof error !== 'object' || !('issues' in error) || !Array.isArray(error.issues)) return {};
  const issues = error.issues
    .filter((issue): issue is { code: string; path: unknown[] } => (
      !!issue && typeof issue === 'object' &&
      'code' in issue && typeof issue.code === 'string' &&
      'path' in issue && Array.isArray(issue.path)
    ))
    .slice(0, 12)
    .map((issue) => ({ code: issue.code, path: issue.path.slice(0, 12) }));
  return issues.length ? { validationIssues: issues } : {};
}
