import { isRecordValue } from '../../plan/value.js';
import { normalizeReportText } from '../../plan/reusability.js';

export function structuralConcatSuffix(expected: string, actual: string): string | undefined {
  const expectedText = normalizeReportText(expected);
  const actualText = normalizeReportText(actual);
  if (!expectedText.startsWith(actualText)) return undefined;
  const suffix = expectedText.slice(actualText.length);
  if (!suffix || suffix.length > 20 || /[\p{L}\p{N}]/u.test(suffix)) return undefined;
  return suffix;
}

export function structuralConcatExtra(expected: string, actual: string): string | undefined {
  const expectedText = normalizeReportText(expected);
  const actualText = normalizeReportText(actual);
  if (!actualText.startsWith(expectedText)) return undefined;
  const extra = actualText.slice(expectedText.length);
  if (!extra || extra.length > 20 || /[\p{L}\p{N}]/u.test(extra)) return undefined;
  return extra;
}

export function structuralConcatGap(expected: string, actual: string): string | undefined {
  const expectedText = normalizeReportText(expected);
  const actualText = normalizeReportText(actual);
  const isStructural = (value: string): boolean => /[^\p{L}\p{N}]/u.test(value);
  let expectedIndex = 0;
  let actualIndex = 0;
  const gaps: string[] = [];
  while (expectedIndex < expectedText.length && actualIndex < actualText.length) {
    if (expectedText[expectedIndex] === actualText[actualIndex]) {
      expectedIndex += 1;
      actualIndex += 1;
      continue;
    }
    if (!isStructural(expectedText[expectedIndex]!)) return undefined;
    const start = expectedIndex;
    while (expectedIndex < expectedText.length
      && isStructural(expectedText[expectedIndex]!)
      && expectedText[expectedIndex] !== actualText[actualIndex]) {
      expectedIndex += 1;
    }
    if (start === expectedIndex) return undefined;
    gaps.push(expectedText.slice(start, expectedIndex));
  }
  if (actualIndex < actualText.length) return undefined;
  if (expectedIndex < expectedText.length
    && !expectedText.slice(expectedIndex).split('').every(isStructural)) return undefined;
  const gap = gaps.join('');
  return gap && gap.length <= 20 ? gap : undefined;
}

export function appendConcatSuffix(value: unknown, suffix: string): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      if (changed) return item;
      const repaired = appendConcatSuffix(item, suffix);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (!isRecordValue(value)) return { value, changed: false };
  if (value.kind === 'concat' && Array.isArray(value.values)) {
    const last = value.values.at(-1);
    if (isRecordValue(last) && last.kind === 'literal' && last.value === suffix) {
      return { value, changed: false };
    }
    return {
      // Keep the existing separator between the source fields. Appending the
      // suffix as another value inside that concat would insert the separator
      // before the closing punctuation as well (for example `A [B []`).
      value: { kind: 'concat', values: [value, { kind: 'literal', value: suffix }], separator: '' },
      changed: true,
    };
  }
  for (const [key, child] of Object.entries(value)) {
    const repaired = appendConcatSuffix(child, suffix);
    if (!repaired.changed) continue;
    return { value: { ...value, [key]: repaired.value }, changed: true };
  }
  return { value, changed: false };
}

export function removeConcatTrailingLiteral(value: unknown, extra: string): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      if (changed) return item;
      const repaired = removeConcatTrailingLiteral(item, extra);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (!isRecordValue(value)) return { value, changed: false };
  if (value.kind === 'concat' && Array.isArray(value.values)) {
    const last = value.values.at(-1);
    if (value.values.length > 1 && isRecordValue(last) && last.kind === 'literal') {
      const separator = typeof value.separator === 'string' ? value.separator : '';
      const literal = String(last.value ?? '');
      const emitted = `${separator}${literal}`;
      if (normalizeReportText(emitted) === normalizeReportText(extra)
        && !/[\p{L}\p{N}]/u.test(emitted)) {
        return { value: { ...value, values: value.values.slice(0, -1) }, changed: true };
      }
    }
    let changed = false;
    const values = value.values.map((item) => {
      if (changed) return item;
      const repaired = removeConcatTrailingLiteral(item, extra);
      changed ||= repaired.changed;
      return repaired.value;
    });
    if (changed) return { value: { ...value, values }, changed: true };
    return { value, changed: false };
  }
  for (const [key, child] of Object.entries(value)) {
    const repaired = removeConcatTrailingLiteral(child, extra);
    if (!repaired.changed) continue;
    return { value: { ...value, [key]: repaired.value }, changed: true };
  }
  return { value, changed: false };
}

export function insertConcatGap(value: unknown, gap: string): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      if (changed) return item;
      const repaired = insertConcatGap(item, gap);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (!isRecordValue(value)) return { value, changed: false };
  if (value.kind === 'concat' && Array.isArray(value.values)) {
    const separator = typeof value.separator === 'string' ? value.separator : '';
    if (!separator && value.values.length === 2) {
      return { value: { ...value, separator: gap }, changed: true };
    }
    // A flat concat often appends a closing punctuation literal. Nest the
    // source portion so the inferred separator is not inserted before that
    // literal as well (`name (id)` instead of `name (id ()`).
    const last = value.values.at(-1);
    if (!separator && value.values.length > 2 && isRecordValue(last)
      && last.kind === 'literal' && typeof last.value === 'string'
      && !/[\p{L}\p{N}]/u.test(last.value)) {
      return {
        value: {
          ...value,
          values: [{ kind: 'concat', values: value.values.slice(0, -1), separator: gap }, last],
        },
        changed: true,
      };
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const repaired = insertConcatGap(child, gap);
    if (!repaired.changed) continue;
    return { value: { ...value, [key]: repaired.value }, changed: true };
  }
  return { value, changed: false };
}
