import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../../layout/schema.js';
import type { ReportPlan, ReportPrimitive } from '../../plan/schema.js';
import type { ReportPlanResult } from '../../plan/execute.js';
import { normalizeReportText } from '../../plan/reusability.js';

function renderTextTemplatePiece(
  token: string,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): string | undefined {
  if (token.startsWith('scalar.')) return result.scalars[token.slice('scalar.'.length)]?.display;
  if (token.startsWith('meta.')) {
    const value = metadata[token.slice('meta.'.length)];
    return value === undefined ? undefined : String(value ?? '');
  }
  const tableMatch = /^table\.([^.]+)\.rowCount$/u.exec(token);
  if (tableMatch) {
    const table = result.tables[tableMatch[1]!];
    return table ? String(table.rows.length) : undefined;
  }
  return undefined;
}

/**
 * PDF text extraction can split one sentence across several adjacent scalar
 * slots. If the model binds the same computed text to all of them, derive
 * reusable token-aligned fragments from the existing template. A fragment is
 * created only when the rendered example and every expected slot concatenate
 * exactly; numeric literal fragments are rejected rather than frozen.
 */
export function repairExampleTextFragments(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  const slots = new Map(pair.scalarSlots.map((slot, index) => [slot.id, { slot, index }]));
  const existingTextIds = new Set(plan.texts.map((text) => text.id));
  const fragments = new Map<string, Array<{ bindingSlotId: string; textId: string; text: ReportPlan['texts'][number] }>>();

  for (const text of plan.texts) {
    if (text.kind !== 'computed') continue;
    const bindings = layout.scalarBindings
      .filter((binding) => binding.value.kind === 'text' && binding.value.id === text.id)
      .map((binding) => ({ binding, location: slots.get(binding.slotId) }))
      .filter((entry): entry is { binding: ReportLayoutPlan['scalarBindings'][number]; location: { slot: PdfReportPairAnalysis['scalarSlots'][number]; index: number } } => Boolean(entry.location))
      .sort((left, right) => left.location.index - right.location.index);
    if (bindings.length < 2) continue;
    const expectedParts = bindings.map((entry) => entry.location.slot.exampleText);

    // A single computed text may need both a token-shape repair and a slot
    // split. Try host-owned metadata substitutions before giving up on the
    // boundary so a full date range can become the year-month prefix used by
    // the completed example without freezing that example value.
    const templateCandidates = new Set<string>([text.template]);
    for (const tokenMatch of text.template.matchAll(/\{\{\s*meta\.([^{}]+?)\s*\}\}/gu)) {
      const currentKey = tokenMatch[1]!.trim();
      for (const key of Object.keys(metadata)) {
        if (key === currentKey) continue;
        const escaped = currentKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        templateCandidates.add(text.template.replace(
          new RegExp(`\\{\\{\\s*meta\\.${escaped}\\s*\\}\\}`, 'gu'),
          `{{meta.${key}}}`,
        ));
      }
    }

    for (const template of templateCandidates) {
      const rendered = renderComputedTextTemplate(template, result, metadata);
      if (rendered === undefined) continue;
      const pieces: Array<{ templateStart: number; templateEnd: number; renderedStart: number; renderedEnd: number; splittable: boolean }> = [];
      const tokenPattern = /\{\{\s*([^{}]+?)\s*\}\}/gu;
      let templateCursor = 0;
      let renderedCursor = 0;
      let match: RegExpExecArray | null;
      let valid = true;
      while ((match = tokenPattern.exec(template))) {
        const literal = template.slice(templateCursor, match.index);
        if (literal) {
          if (!rendered.startsWith(literal, renderedCursor)) { valid = false; break; }
          pieces.push({ templateStart: templateCursor, templateEnd: match.index,
            renderedStart: renderedCursor, renderedEnd: renderedCursor + literal.length, splittable: true });
          renderedCursor += literal.length;
        }
        const tokenValue = renderTextTemplatePiece(match[1]!.trim(), result, metadata);
        if (tokenValue === undefined || !rendered.startsWith(tokenValue, renderedCursor)) { valid = false; break; }
        pieces.push({ templateStart: match.index, templateEnd: tokenPattern.lastIndex,
          renderedStart: renderedCursor, renderedEnd: renderedCursor + tokenValue.length, splittable: false });
        renderedCursor += tokenValue.length;
        templateCursor = tokenPattern.lastIndex;
      }
      if (!valid) continue;
      const trailing = template.slice(templateCursor);
      if (trailing) {
        if (!rendered.startsWith(trailing, renderedCursor)) continue;
        pieces.push({ templateStart: templateCursor, templateEnd: template.length,
          renderedStart: renderedCursor, renderedEnd: renderedCursor + trailing.length, splittable: true });
        renderedCursor += trailing.length;
      }
      if (renderedCursor !== rendered.length) continue;
      const templateOffset = (boundary: number): number | undefined => {
        if (boundary === 0) return 0;
        if (boundary === rendered.length) return template.length;
        const piece = pieces.find((candidate) => (
          candidate.renderedStart <= boundary && boundary <= candidate.renderedEnd
        ));
        if (!piece) return undefined;
        if (boundary === piece.renderedStart) return piece.templateStart;
        if (boundary === piece.renderedEnd) return piece.templateEnd;
        return piece.splittable
          ? piece.templateStart + (boundary - piece.renderedStart)
          : undefined;
      };
      const matchExpectedPart = (cursor: number, expectedPart: string): { end: number; next: number } | undefined => {
        const escaped = expectedPart.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+');
        const expectedMatch = new RegExp(`^${escaped}`, 'u').exec(rendered.slice(cursor));
        if (!expectedMatch) return undefined;
        const end = cursor + expectedMatch[0].length;
        let next = end;
        while (/\s/u.test(rendered[next] ?? '')) next += 1;
        return { end, next };
      };

      let renderedBoundary = 0;
      let templateStart = 0;
      const generated = bindings.map((entry, index) => {
        const part = expectedParts[index]!;
        const expectedMatch = matchExpectedPart(renderedBoundary, part);
        if (!expectedMatch) return undefined;
        renderedBoundary = expectedMatch.next;
        // Keep whitespace introduced by the PDF slot boundary out of both
        // fragments. `end` is before the optional inter-slot whitespace;
        // `next` is the cursor used to match the following slot.
        const templateEnd = templateOffset(expectedMatch.end);
        if (templateEnd === undefined) return undefined;
        const fragmentTemplate = template.slice(templateStart, templateEnd);
        const hasToken = /\{\{\s*(?:scalar|table|meta)\./u.test(fragmentTemplate);
        if (!hasToken && /\d/u.test(fragmentTemplate)) return undefined;
        const suffix = index === 0 ? 'lead' : index === bindings.length - 1 ? 'tail' : String(index + 1);
        const textId = `${text.id}-${suffix}`;
        if (existingTextIds.has(textId)) return undefined;
        templateStart = templateEnd;
        while (/\s/u.test(template[templateStart] ?? '')) templateStart += 1;
        return {
          bindingSlotId: entry.binding.slotId,
          textId,
          text: hasToken
            ? { id: textId, kind: 'computed' as const, template: fragmentTemplate }
            : { id: textId, kind: 'invariant' as const, value: fragmentTemplate },
        };
      });
      if (renderedBoundary !== rendered.length || generated.some((fragment) => !fragment)) continue;
      fragments.set(text.id, generated as Array<{ bindingSlotId: string; textId: string; text: ReportPlan['texts'][number] }>);
      break;
    }
  }

  if (fragments.size === 0) return { plan, layout };
  const replacements = new Map([...fragments.values()].flat().map((fragment) => [fragment.bindingSlotId, fragment.textId]));
  const nextTexts = [...plan.texts, ...[...fragments.values()].flat().map((fragment) => fragment.text)];
  const nextLayout = {
    ...layout,
    scalarBindings: layout.scalarBindings.map((binding) => {
      const textId = replacements.get(binding.slotId);
      return textId ? { ...binding, value: { kind: 'text' as const, id: textId } } : binding;
    }),
  };
  return { plan: { ...plan, texts: nextTexts }, layout: nextLayout };
}

function renderComputedTextTemplate(
  template: string,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): string | undefined {
  let complete = true;
  const rendered = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (_match, rawToken: string) => {
    const value = renderTextTemplatePiece(rawToken.trim(), result, metadata);
    if (value === undefined) complete = false;
    return value ?? '';
  });
  return complete ? rendered : undefined;
}

/**
 * A computed sentence can use a valid metadata token with the wrong display
 * shape (for example a full date range where the example shows year-month).
 * Try only host-provided metadata substitutions and keep a change when one
 * candidate reproduces the exact bound example slot; no example data is added
 * to the reusable plan.
 */
export function repairExampleTextBindings(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const texts = plan.texts.map((text) => {
    if (text.kind !== 'computed') return text;
    const bindings = layout.scalarBindings.filter((binding) => (
      binding.value.kind === 'text' && binding.value.id === text.id
    ));
    if (bindings.length !== 1) return text;
    const slot = slots.get(bindings[0]!.slotId);
    if (!slot) return text;
    const expected = normalizeReportText(slot.exampleText);
    const tokenMatches = [...text.template.matchAll(/\{\{\s*meta\.([^{}]+?)\s*\}\}/gu)];
    if (!tokenMatches.length) return text;
    const candidates = new Map<string, string>();
    for (const match of tokenMatches) {
      const currentKey = match[1]!.trim();
      for (const key of Object.keys(metadata)) {
        if (key === currentKey) continue;
        const escaped = currentKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const candidateTemplate = text.template.replace(
          new RegExp(`\\{\\{\\s*meta\\.${escaped}\\s*\\}\\}`, 'gu'),
          `{{meta.${key}}}`,
        );
        const rendered = renderComputedTextTemplate(candidateTemplate, result, metadata);
        if (rendered !== undefined && normalizeReportText(rendered) === expected) {
          candidates.set(candidateTemplate, key);
        }
      }
    }
    if (candidates.size !== 1) return text;
    const [template] = candidates.keys();
    return template && template !== text.template ? { ...text, template } : text;
  });
  if (!texts.some((text, index) => text !== plan.texts[index])) return { plan, layout };
  return {
    plan: { ...plan, texts },
    layout,
  };
}
