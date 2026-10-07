import type { ReportPlan } from '../../plan/schema.js';
import { isRecordValue } from '../../plan/value.js';
import { fail } from './snapshot.js';
import type { StructuralIssue } from './corrections.js';

function previewSource(value: unknown): string | undefined {
  return isRecordValue(value) && value.kind === 'preview' && typeof value.source === 'string'
    ? value.source : undefined;
}

function requestedEvidenceSource(value: unknown): string | undefined {
  if (!isRecordValue(value) || !isRecordValue(value.request) || value.request.kind === 'page') return undefined;
  return typeof value.request.source === 'string' ? value.request.source : undefined;
}

/**
 * Previews bootstrap cross-source reasoning, but become redundant once the
 * same alias has a profile or row result. Remove only those redundant
 * previews when the surrounding revision payload is close to its context
 * limit; the direct, host-computed evidence remains intact.
 */
function withoutRedundantPreviews(history: unknown[]): unknown[] {
  const requestedSources = new Set(history.map(requestedEvidenceSource)
    .filter((source): source is string => source !== undefined));
  if (requestedSources.size === 0) return history;
  return history.filter((entry) => {
    const source = previewSource(entry);
    return source === undefined || !requestedSources.has(source);
  });
}

function withoutPreviews(history: unknown[]): unknown[] {
  return history.filter((entry) => previewSource(entry) === undefined);
}

/**
 * If every preview has been removed and the context is still too large,
 * preserve the first and last rows plus the original row count. Mark the
 * result as a sample so a model never mistakes a compacted payload for a
 * complete snapshot.
 */
function compactEvidenceResults(history: unknown[]): unknown[] {
  return history.map((entry) => {
    if (!isRecordValue(entry) || !isRecordValue(entry.result)) return entry;
    const result = entry.result;
    if (result.kind === 'rows' && Array.isArray(result.rows) && result.rows.length > 6) {
      return { ...entry, result: {
        ...result,
        rows: [...result.rows.slice(0, 3), ...result.rows.slice(-3)],
        sampleOnly: true,
        omittedRowCount: result.rows.length - 6,
        contextCompacted: true,
      } };
    }
    if (result.kind === 'profile' && Array.isArray(result.profiles)) {
      const profiles = result.profiles.map((profile) => {
        if (!isRecordValue(profile) || !Array.isArray(profile.distinctExamples) || profile.distinctExamples.length <= 8) {
          return profile;
        }
        return { ...profile, distinctExamples: profile.distinctExamples.slice(0, 8),
          omittedDistinctExamples: profile.distinctExamples.length - 8, distinctExamplesComplete: false };
      });
      return { ...entry, result: { ...result, profiles, contextCompacted: true } };
    }
    return entry;
  });
}

export function serializeEvidenceContext(input: {
  base: unknown;
  sources: unknown;
  history: unknown[];
  round: number;
  remainingEvidenceRequests: number;
  validationIssues: StructuralIssue[];
  rejectedReportPlan?: ReportPlan;
  maxChars: number;
}): string {
  const makeContext = (history: unknown[]) => ({
    task: input.base,
    sources: input.sources,
    evidence: history,
    round: input.round,
    remainingEvidenceRequests: input.remainingEvidenceRequests,
    ...(input.validationIssues.length ? { validationIssues: input.validationIssues } : {}),
    ...(input.rejectedReportPlan ? { rejectedReportPlan: input.rejectedReportPlan } : {}),
  });
  const variants = [
    input.history,
    withoutRedundantPreviews(input.history),
    withoutPreviews(input.history),
    compactEvidenceResults(withoutPreviews(input.history)),
  ];
  const seen = new Set<string>();
  for (const history of variants) {
    const serialized = JSON.stringify(makeContext(history));
    if (seen.has(serialized)) continue;
    seen.add(serialized);
    if (serialized.length <= input.maxChars) return serialized;
  }
  return fail('report_evidence_context_limit');
}
