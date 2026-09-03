import { boundedText } from './values.js';

const QUALITY_ISSUE_CODES = new Set([
  'source_unavailable',
  'schema_column_missing',
  'schema_type_changed',
  'output_section_missing',
  'output_type_changed',
  'output_volume_anomaly',
]);

export function qualityIssuesFromLog(logJson: string, errorCode: string | null): {
  phase?: string;
  issues: Array<{ code: string; path: string; message: string; expected?: string; actual?: string }>;
} {
  let entries: unknown;
  try {
    entries = JSON.parse(logJson);
  } catch {
    return { issues: [] };
  }
  if (!Array.isArray(entries)) return { issues: [] };

  for (const entry of [...entries].reverse()) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (record.code !== 'output_contract_failed' && record.code !== 'input_schema_drift') continue;
    const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? record.data as Record<string, unknown>
      : undefined;
    const issues = Array.isArray(data?.issues)
      ? data.issues.flatMap((raw): Array<{ code: string; path: string; message: string; expected?: string; actual?: string }> => {
        if (!raw || typeof raw !== 'object') return [];
        const issueRecord = raw as Record<string, unknown>;
        const code = boundedText(issueRecord.code, 80);
        const path = boundedText(issueRecord.path, 200);
        const message = boundedText(issueRecord.message, 500);
        const expected = boundedText(issueRecord.expected, 120);
        const actual = boundedText(issueRecord.actual, 120);
        if (!code || !path || !message || !QUALITY_ISSUE_CODES.has(code)) return [];
        return [{
          code,
          path,
          message,
          ...(expected ? { expected } : {}),
          ...(actual ? { actual } : {}),
        }];
      })
      : [];
    return {
      phase: boundedText(data?.phase, 80),
      issues,
    };
  }
  return { issues: [] };
}
