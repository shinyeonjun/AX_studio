import type { ReportSourceSnapshot } from '../../plan/schema.js';
import type { ReportEvidenceRequest } from './schema.js';

const MAX_RESPONSE_CHARS = 16_000;
const MAX_PREVIEW_ROWS = 5;
export const MAX_WIDE_PREVIEW_ROWS = 25;
const MAX_PREVIEW_COLUMNS = 16;
const MAX_PREVIEW_VALUE_CHARS = 512;
const MAX_PREVIEW_CHARS = 12_000;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const fail = (code: string): never => { throw new Error(code); };

function bounded(value: unknown, max: number): string {
  const serialized = JSON.stringify(value);
  if (serialized.length > max) fail('report_evidence_context_limit');
  return serialized;
}

function previewValue(value: unknown, depth = 0, maxStringChars = MAX_PREVIEW_VALUE_CHARS): { value: unknown; truncated: boolean } {
  if (value === undefined) return { value: null, truncated: false };
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return { value, truncated: false };
  if (typeof value === 'string') return { value: value.slice(0, maxStringChars), truncated: value.length > maxStringChars };
  if (depth >= 2) return { value: '[nested value]', truncated: true };
  if (Array.isArray(value)) {
    const children = value.slice(0, 20).map((item) => previewValue(item, depth + 1, maxStringChars));
    return { value: children.map((child) => child.value), truncated: value.length > children.length || children.some((child) => child.truncated) };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const children = entries.slice(0, 20).map(([key, item]) => [key, previewValue(item, depth + 1, maxStringChars)] as const);
    return { value: Object.fromEntries(children.map(([key, child]) => [key, child.value])),
      truncated: entries.length > children.length || children.some(([, child]) => child.truncated) };
  }
  const text = String(value);
  return { value: text.slice(0, maxStringChars), truncated: text.length > maxStringChars };
}

function numericEvidenceValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/,/gu, '');
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type NumericEvidenceSummary = {
  count: number;
  sum: number;
  minimum: number;
  maximum: number;
};

function numericEvidenceSummary(values: unknown[]): NumericEvidenceSummary | undefined {
  let count = 0;
  let sum = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const raw of values) {
    const value = numericEvidenceValue(raw);
    if (value === undefined) continue;
    count += 1;
    sum += value;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return count === 0 ? undefined : { count, sum, minimum, maximum };
}

/** Host-owned access to already-authorized, immutable example snapshots only. */
export class ReportEvidence {
  private readonly fields = new Map<string, string[]>();

  constructor(
    private readonly sources: Record<string, ReportSourceSnapshot>,
    private readonly options: { detailedProfiles?: boolean } = {},
  ) {
    if (Object.keys(sources).length > 64) fail('report_evidence_catalog_limit');
    for (const [alias, source] of Object.entries(sources)) {
      if (!source.complete) fail(`report_evidence_source_incomplete:${alias}`);
      const fields = new Set<string>();
      for (const row of source.rows) {
        for (const key of Object.keys(row)) {
          fields.add(key);
          if (fields.size > 256) fail('report_evidence_catalog_limit');
        }
      }
      this.fields.set(alias, [...fields].sort());
    }
  }

  summary() {
    return [...this.fields].map(([source, columns]) => ({
      source, columns, rowCount: this.sources[source]!.rows.length,
      complete: this.sources[source]!.complete,
      provenance: this.sources[source]!.provenance,
      fingerprint: this.sources[source]!.fingerprint,
      valuesDisclosed: false,
    }));
  }

  read(request: Exclude<ReportEvidenceRequest, { kind: 'page' }>) {
    if (!own(this.sources, request.source)) fail('report_evidence_source_invalid');
    const source = this.sources[request.source]!;
    const columns = [...new Set(request.columns)].sort();
    if (columns.some((column) => !this.fields.get(request.source)!.includes(column))) {
      fail('report_evidence_column_invalid');
    }
    if (request.kind === 'rows') {
      if (request.offset > source.rows.length) fail('report_evidence_offset_invalid');
      const end = Math.min(request.offset + request.limit, source.rows.length);
      const rows = source.rows.slice(request.offset, end).map((row) =>
        Object.fromEntries(columns.map((column) => {
          const value = own(row, column) ? row[column] : null;
          return [column, value === undefined ? null : value];
        })));
      return JSON.parse(bounded({ kind: 'rows', source: request.source, columns,
        offset: request.offset, rows, rowCount: source.rows.length,
        nextOffset: end < source.rows.length ? end : null,
        sampleOnly: request.offset !== 0 || end !== source.rows.length,
        missingFieldsAsNull: true }, MAX_RESPONSE_CHARS)) as unknown;
    }
    const profiles = columns.map((column) => {
      let missing = 0, nulls = 0, minimum: number | null = null, maximum: number | null = null;
      const types: Record<string, number> = {};
      const values = new Set<string>();
      let valuesTruncated = false;
      for (const row of source.rows) {
        if (!own(row, column)) { missing++; continue; }
        const value = row[column];
        if (value == null) { nulls++; continue; }
        const type = Array.isArray(value) ? 'array' : typeof value;
        types[type] = (types[type] ?? 0) + 1;
        if (typeof value === 'number' && Number.isFinite(value)) {
          minimum = minimum === null ? value : Math.min(minimum, value);
          maximum = maximum === null ? value : Math.max(maximum, value);
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          const text = JSON.stringify(value);
          if (text.length > 200) { valuesTruncated = true; continue; }
          if (values.has(text)) continue;
          if (values.size < 20) values.add(text);
          else valuesTruncated = true;
        }
      }
      const numeric = this.options.detailedProfiles
        ? numericEvidenceSummary(source.rows.map(row => own(row, column) ? row[column] : undefined))
        : undefined;
      return { column, missing, nulls, types, minimum, maximum,
        ...(numeric ? { numericCount: numeric.count, numericSum: numeric.sum,
          numericMinimum: numeric.minimum, numericMaximum: numeric.maximum } : {}),
        distinctExamples: [...values].map((value) => JSON.parse(value) as unknown),
        distinctExamplesComplete: !valuesTruncated && !types.object && !types.array };
    });
    const numericColumnCandidates = profiles
      .filter(profile => profile.numericCount !== undefined)
      .map(profile => profile.column);
    const numericColumns = numericColumnCandidates.slice(0, 8);
    const groupedNumericCandidates = this.options.detailedProfiles ? columns
      .map(column => {
        const values = new Map<string, { value: string | number | boolean | null; rows: Array<Record<string, unknown>> }>();
        for (const row of source.rows) {
          const value = own(row, column) ? row[column] : null;
          if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
          const key = JSON.stringify(value);
          const current = values.get(key);
          if (current) current.rows.push(row);
          else values.set(key, { value, rows: [row] });
        }
        if (values.size === 0 || values.size > 20 || numericColumns.length === 0) return undefined;
        const groups = [...values.values()].map(group => ({
          value: group.value,
          rowCount: group.rows.length,
          numeric: numericColumns.flatMap(numericColumn => {
            const summary = numericEvidenceSummary(group.rows.map(row => own(row, numericColumn) ? row[numericColumn] : undefined));
            return summary ? [{ column: numericColumn, ...summary }] : [];
          }),
        }));
        return { column, groups };
      })
      .filter((value): value is { column: string; groups: Array<{ value: string | number | boolean | null; rowCount: number; numeric: Array<{ column: string } & NumericEvidenceSummary> }> } => Boolean(value))
      : [];
    const groupedNumeric = groupedNumericCandidates.slice(0, 4);
    const baseProfile = {
      kind: 'profile', source: request.source, rowCount: source.rows.length,
      ...(numericColumnCandidates.length > numericColumns.length ? { numericColumnsTruncated: true } : {}),
      ...(groupedNumericCandidates.length > groupedNumeric.length ? { groupedNumericTruncated: true } : {}),
    };
    // Distinct examples are useful semantic clues but are never allowed to
    // make an otherwise valid profile unreadable. Reduce only that optional
    // clue first, mark the omission on each profile, then drop grouped totals
    // as a last resort. Whole-snapshot null/type/numeric fields remain intact.
    for (const examplesLimit of [20, 8, 4, 0]) {
      const compactedProfiles = profiles.map((profile) => {
        if (profile.distinctExamples.length <= examplesLimit) return profile;
        return { ...profile,
          distinctExamples: profile.distinctExamples.slice(0, examplesLimit),
          omittedDistinctExamples: profile.distinctExamples.length - examplesLimit,
          distinctExamplesComplete: false };
      });
      for (const includeGrouped of [true, false]) {
        const candidate = { ...baseProfile, profiles: compactedProfiles,
          ...(includeGrouped && groupedNumeric.length ? { groupedNumeric } : {}),
          ...(includeGrouped && groupedNumericCandidates.length > groupedNumeric.length
            ? { groupedNumericTruncated: true } : {}),
          ...(examplesLimit < 20 ? { profileContextCompacted: true } : {}),
          ...(!includeGrouped && groupedNumericCandidates.length > 0 ? { groupedNumericTruncated: true } : {}),
        };
        const serialized = JSON.stringify(candidate);
        if (serialized.length <= MAX_RESPONSE_CHARS) return JSON.parse(serialized) as unknown;
      }
    }
    return fail('report_evidence_context_limit');
  }

  preview(sourceName: string, options: { limit?: number; valueChars?: number } = {}) {
    if (!own(this.sources, sourceName)) fail('report_evidence_source_invalid');
    const source = this.sources[sourceName]!;
    const requestedLimit = Math.min(options.limit ?? MAX_PREVIEW_ROWS, MAX_WIDE_PREVIEW_ROWS);
    const requestedValueChars = Math.min(options.valueChars ?? MAX_PREVIEW_VALUE_CHARS, MAX_PREVIEW_VALUE_CHARS);
    const allColumns = this.fields.get(sourceName)!;
    const columns = allColumns.slice(0, MAX_PREVIEW_COLUMNS);
    const columnsTruncated = columns.length < allColumns.length;
    let limit = requestedLimit;
    let valueChars = requestedValueChars;
    for (;;) {
      let valuesTruncated = false;
      const rows = source.rows.slice(0, limit).map((row) => Object.fromEntries(
        columns.map((column) => {
          if (!own(row, column)) return [column, null];
          const preview = previewValue(row[column], 0, valueChars);
          valuesTruncated ||= preview.truncated;
          return [column, preview.value];
        }),
      ));
      const end = Math.min(limit, source.rows.length);
      const rowsTruncated = end < source.rows.length;
      const candidate = { kind: 'preview', source: sourceName, columns, rows,
        rowCount: source.rows.length, nextOffset: end < source.rows.length ? end : null,
        rowsTruncated, columnsTruncated,
        sampleOnly: rowsTruncated || columnsTruncated || valuesTruncated,
        valuesTruncated };
      const serialized = JSON.stringify(candidate);
      if (serialized.length <= MAX_PREVIEW_CHARS) return JSON.parse(serialized) as unknown;
      if (limit > 1) {
        limit = Math.max(1, Math.floor(limit / 2));
        continue;
      }
      if (valueChars > 32) {
        valueChars = Math.max(32, Math.floor(valueChars / 2));
        continue;
      }
      return fail('report_evidence_context_limit');
    }
  }
}
