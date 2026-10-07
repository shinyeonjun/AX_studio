import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../../layout/schema.js';
import type { ReportPlan } from '../../plan/schema.js';
import { normalizeReportText } from '../../plan/reusability.js';

/**
 * The completed example is authoritative for static wording. If the model
 * binds a static text id to one or more example slots, restore the exact slot
 * wording when all bound slots agree. Numeric/date content is still rejected
 * by the reusable-plan validator after this repair.
 */
export function repairStaticTextValues(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportPlan {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const texts = plan.texts.map((text) => {
    if (text.kind === 'computed') return text;
    const examples = layout.scalarBindings
      .filter((binding) => binding.value.kind === 'text' && binding.value.id === text.id)
      .map((binding) => slots.get(binding.slotId)?.exampleText)
      .filter((value): value is string => value !== undefined);
    if (examples.length === 0) return text;
    const expected = normalizeReportText(examples[0]!);
    if (examples.some((value) => normalizeReportText(value) !== expected)) return text;
    return text.kind === 'invariant'
      ? { ...text, value: examples[0]! }
      : { ...text, exampleValue: examples[0]! };
  });
  return { ...plan, texts };
}

/**
 * A model can reuse one invariant text id for several visually separate
 * notes. When the completed example proves that those slots contain different
 * nonnumeric prose, preserve the existing matching binding and create a
 * bounded invariant for each unmatched slot. Numeric/date slots stay
 * rejected so this repair cannot freeze report data into the plan.
 */
export function repairStaticTextBindingConflicts(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const nextTexts = [...plan.texts];
  const existingIds = new Set(nextTexts.map((text) => text.id));
  let changed = false;
  const scalarBindings = layout.scalarBindings.map((binding) => {
    const value = binding.value;
    if (value.kind !== 'text') return binding;
    const text = (plan as ReportPlan).texts.find(
      (candidate: ReportPlan['texts'][number]) => candidate.id === value.id,
    );
    const slot = slots.get(binding.slotId);
    if (!slot) return binding;
    if (!text) {
      // A layout response can retain a stale text id after the calculation
      // response omitted an optional note. Recreate only exact, nonnumeric
      // example prose; unresolved data-like text remains fail-closed.
      const expected = normalizeReportText(slot.exampleText);
      if (!expected || /\d/u.test(expected)) return binding;
      const matching = nextTexts.find((candidate) => {
        if (candidate.kind === 'computed') return false;
        const candidateValue = candidate.kind === 'invariant' ? candidate.value : candidate.exampleValue;
        return normalizeReportText(candidateValue) === expected;
      });
      if (matching) {
        changed = true;
        return { ...binding, value: { kind: 'text' as const, id: matching.id } };
      }
      let id = `${value.id}-example-${binding.slotId}`;
      let suffix = 2;
      while (existingIds.has(id)) id = `${value.id}-example-${binding.slotId}-${suffix++}`;
      nextTexts.push({ id, kind: 'invariant', value: slot.exampleText });
      existingIds.add(id);
      changed = true;
      return { ...binding, value: { kind: 'text' as const, id } };
    }
    if (text.kind === 'computed') return binding;
    const actual = text.kind === 'invariant' ? text.value : text.exampleValue;
    if (normalizeReportText(actual) === normalizeReportText(slot.exampleText)) return binding;
    const matching = nextTexts.find((candidate) => {
      if (candidate.kind === 'computed') return false;
      const value = candidate.kind === 'invariant' ? candidate.value : candidate.exampleValue;
      return normalizeReportText(value) === normalizeReportText(slot.exampleText);
    });
    if (matching) {
      changed = true;
      return { ...binding, value: { kind: 'text' as const, id: matching.id } };
    }
    if (/\d/u.test(slot.exampleText)) return binding;
    let id = `${text.id}-example-${binding.slotId}`;
    let suffix = 2;
    while (existingIds.has(id)) id = `${text.id}-example-${binding.slotId}-${suffix++}`;
    nextTexts.push({ id, kind: 'invariant', value: slot.exampleText });
    existingIds.add(id);
    changed = true;
    return { ...binding, value: { kind: 'text' as const, id } };
  });
  return changed
    ? { plan: { ...plan, texts: nextTexts }, layout: { ...layout, scalarBindings } }
    : { plan, layout };
}

/**
 * Layout inference is a binding task, so an omitted binding can be repaired
 * without asking the model to guess. Only an unbound scalar slot whose
 * completed-example text exactly matches a static plan text is eligible.
 * Unknown or paraphrased text remains rejected by the presentation validator.
 */
export function repairStaticTextBindings(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportLayoutPlan {
  const scalarBindings = [...layout.scalarBindings];
  const boundSlotIds = new Set(scalarBindings.map((binding) => binding.slotId));
  const boundTextIds = new Set(scalarBindings.flatMap((binding) => (
    binding.value.kind === 'text' ? [binding.value.id] : []
  )));
  const groups = new Map<string, Array<{ id: string }>>();

  for (const text of plan.texts) {
    if (text.kind === 'computed') continue;
    const expected = text.kind === 'invariant' ? text.value : text.exampleValue;
    const key = normalizeReportText(expected);
    const group = groups.get(key);
    if (group) group.push({ id: text.id });
    else groups.set(key, [{ id: text.id }]);
  }

  const bind = (slotId: string, textId: string): void => {
    scalarBindings.push({ slotId, value: { kind: 'text', id: textId } });
    boundSlotIds.add(slotId);
    boundTextIds.add(textId);
  };

  for (const [expected, texts] of groups) {
    const candidates = pair.scalarSlots.filter((slot) => (
      !boundSlotIds.has(slot.id) && normalizeReportText(slot.exampleText) === expected
    ));
    if (candidates.length === 0) continue;

    let candidateIndex = 0;
    for (const text of texts) {
      if (boundTextIds.has(text.id)) continue;
      const slot = candidates[candidateIndex++];
      if (!slot) break;
      bind(slot.id, text.id);
    }

    // A single static text can legitimately occupy multiple scalar slots.
    // Bind any remaining exact matches to the first text in this group.
    const fallbackTextId = texts[0]!.id;
    while (candidateIndex < candidates.length) {
      bind(candidates[candidateIndex++]!.id, fallbackTextId);
    }
  }

  return { ...layout, scalarBindings };
}

/**
 * Layout bindings are the only values that can reach the rendered PDF. Drop
 * model-declared text records that have no physical binding so an optional
 * note cannot make an otherwise valid report fail presentation validation.
 * Bound text remains subject to the strict example-derived checks below.
 */
export function pruneUnboundReportTexts(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
): ReportPlan {
  const boundTextIds = new Set(layout.scalarBindings.flatMap((binding) => (
    binding.value.kind === 'text' ? [binding.value.id] : []
  )));
  return { ...plan, texts: plan.texts.filter((text) => boundTextIds.has(text.id)) };
}
