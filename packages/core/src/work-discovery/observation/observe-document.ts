import { randomUUID } from 'node:crypto';
import type { DocumentArtifact } from '../../contracts/artifacts/document.js';
import type { OutputObservation, ObservationValue } from './schema.js';

const LABEL_VALUE_RE = /([^\s:：\n]{2,20})\s*[:：]\s*([^\n]+)/g;
const NUMBER_WITH_LABEL_RE = /([가-힣A-Za-z][가-힣A-Za-z0-9_\-]{1,20})\s+([+-]?\d[\d,]*(?:\.\d+)?(?:억|만|천|%)?)/g;

export function parseKoreanNumber(text: string): number | null {
  const normalized = text.replace(/,/g, '').trim();
  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)(억|만|천|%)?$/);
  if (!match) {
    const plain = Number(normalized);
    return Number.isFinite(plain) ? plain : null;
  }
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  switch (match[2]) {
    case '억':
      return base * 100_000_000;
    case '만':
      return base * 10_000;
    case '천':
      return base * 1_000;
    case '%':
      return base;
    default:
      return base;
  }
}

export function slugifyLabel(label: string): string {
  const trimmed = label.trim();
  if (/[가-힣]/.test(trimmed)) {
    return `field.${trimmed.replace(/\s+/g, '_')}`;
  }
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

export function observationFromNumber(
  exampleId: string,
  label: string,
  display: string,
  pageIndex?: number,
  semanticLocation?: string,
): OutputObservation | null {
  const value = parseKoreanNumber(display);
  if (value == null) return null;
  const basePath = slugifyLabel(label);
  const path = semanticLocation ? `${basePath}.${semanticLocation}` : basePath;
  const observationValue: ObservationValue = {
    kind: 'number',
    value,
    display,
    unit: display.includes('%') ? '%' : display.includes('억') ? '억' : undefined,
  };
  return {
    id: `obs_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    exampleId,
    path,
    label,
    value: observationValue,
    location: pageIndex == null ? undefined : { pageIndex },
    role: 'dynamic_value',
    required: true,
  };
}

function collectTextSegments(document: DocumentArtifact): Array<{ text: string; pageIndex?: number }> {
  const segments: Array<{ text: string; pageIndex?: number }> = [];
  for (const page of document.pages) {
    if (page.text?.trim()) {
      segments.push({ text: page.text, pageIndex: page.index });
    }
  }
  for (const table of document.tables) {
    if (table.text?.trim()) {
      segments.push({ text: table.text, pageIndex: table.pageIndex });
    }
  }
  if (document.text?.trim()) {
    segments.push({ text: document.text });
  }
  return segments;
}

/**
 * Extracts numeric observations from a document.
 *
 * Only an explicitly labeled value (`라벨: 값`) whose label occurs once in the document gets a
 * stable label-based path and becomes a required output field. Loosely matched numbers and
 * repeated labels keep positional paths for evidence but are optional, so a discovery is not
 * forced to explain every number in an example.
 */
export function observeDocumentArtifact(exampleId: string, document: DocumentArtifact): OutputObservation[] {
  const matches: Array<{
    label: string;
    display: string;
    labeled: boolean;
    pageIndex?: number;
    semanticLocation: string;
  }> = [];
  const seen = new Set<string>();

  for (const [segmentIndex, segment] of collectTextSegments(document).entries()) {
    const text = segment.text;
    const labelOrdinals = new Map<string, number>();
    const observeMatch = (label: string, display: string, labeled: boolean): void => {
      const key = `${label}:${display}`;
      if (seen.has(key) || parseKoreanNumber(display) == null) return;
      const ordinal = (labelOrdinals.get(label) ?? 0) + 1;
      const pagePart = segment.pageIndex == null ? 'document' : `page_${segment.pageIndex + 1}`;
      labelOrdinals.set(label, ordinal);
      seen.add(key);
      matches.push({
        label,
        display,
        labeled,
        pageIndex: segment.pageIndex,
        semanticLocation: `${pagePart}.segment_${segmentIndex + 1}.value_${ordinal}`,
      });
    };

    for (const match of text.matchAll(LABEL_VALUE_RE)) {
      observeMatch(match[1]!.trim(), match[2]!.trim(), true);
    }
    for (const match of text.matchAll(NUMBER_WITH_LABEL_RE)) {
      observeMatch(match[1]!.trim(), match[2]!.trim(), false);
    }
  }

  const labelCounts = new Map<string, number>();
  for (const match of matches) labelCounts.set(match.label, (labelCounts.get(match.label) ?? 0) + 1);

  return matches.flatMap((match) => {
    const stableField = match.labeled && labelCounts.get(match.label) === 1;
    const observation = observationFromNumber(
      exampleId,
      match.label,
      match.display,
      match.pageIndex,
      stableField ? undefined : match.semanticLocation,
    );
    return observation ? [{ ...observation, required: stableField }] : [];
  });
}
