import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import type { ReportLayoutPlan, ReportLayoutValue } from '../../layout/schema.js';
import type { ReportPlan, ReportPrimitive } from '../../plan/schema.js';
import type { ReportPlanResult } from '../../plan/execute.js';
import { normalizeReportText } from '../../plan/reusability.js';

function layoutValueDisplay(
  value: ReportLayoutValue,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): string | undefined {
  if (value.kind === 'scalar') return result.scalars[value.id]?.display;
  if (value.kind === 'text') return result.texts[value.id];
  const metadataValue = metadata[value.key];
  return metadataValue === undefined ? undefined : String(metadataValue ?? '');
}

/**
 * Rebind a slot only when a host-calculated value exactly reproduces the
 * completed example text. This repairs presentation drift such as choosing
 * `periodLabel` for a date-range slot while refusing to guess when no exact
 * derived value exists.
 */
export function repairExampleScalarBindings(
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): ReportLayoutPlan {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const candidates: ReportLayoutValue[] = [
    ...Object.keys(result.scalars).sort().map((id) => ({ kind: 'scalar' as const, id })),
    ...Object.keys(result.texts).sort().map((id) => ({ kind: 'text' as const, id })),
    ...Object.keys(metadata).sort().map((key) => ({ kind: 'metadata' as const, key })),
  ];
  return {
    ...layout,
    scalarBindings: layout.scalarBindings.map((binding) => {
      const slot = slots.get(binding.slotId);
      if (!slot) return binding;
      const current = layoutValueDisplay(binding.value, result, metadata);
      const expected = normalizeReportText(slot.exampleText);
      if (current !== undefined && normalizeReportText(current) === expected) return binding;
      const matches = candidates.filter((candidate) => {
        const display = layoutValueDisplay(candidate, result, metadata);
        return display !== undefined && normalizeReportText(display) === expected;
      });
      return matches.length === 1 ? { ...binding, value: matches[0]! } : binding;
    }),
  };
}

function sourceIdentityMetadataKey(key: string): boolean {
  return /(?:source|origin|provider|system)/iu.test(key);
}

function sourceIdentityWording(value: string): boolean {
  return /(?:rest|http|api|postgres(?:ql)?|mysql|sql|crm|source|origin|provider|system|데이터|원천|연결)/iu.test(value);
}

/**
 * Source labels are stable presentation prose for a fixed capture plan, but
 * models sometimes bind a transport-oriented metadata value (for example an
 * endpoint path) to a human-written label in the completed example. Preserve
 * the exact nonnumeric source wording as an invariant only when the binding
 * is clearly source identity related. Example-only state labels become phase
 * text so the target run can still render its host-owned status value.
 */
export function repairExamplePresentationBindings(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  metadata: Record<string, ReportPrimitive>,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const texts = [...plan.texts];
  const textByValue = new Map<string, ReportPlan['texts'][number]>();
  const phaseTextByValue = new Map<string, Extract<ReportPlan['texts'][number], { kind: 'phase' }>>();
  for (const text of texts) {
    if (text.kind === 'computed') continue;
    const value = text.kind === 'invariant' ? text.value : text.exampleValue;
    textByValue.set(normalizeReportText(value), text);
    if (text.kind === 'phase') phaseTextByValue.set(normalizeReportText(value), text);
  }
  const existingIds = new Set(texts.map((text) => text.id));
  let changed = false;
  const scalarBindings = layout.scalarBindings.map((binding) => {
    if (binding.value.kind !== 'metadata') return binding;
    const slot = slots.get(binding.slotId);
    if (!slot) return binding;
    const expected = normalizeReportText(slot.exampleText);
    if (!expected || /\d/u.test(expected)) {
      return binding;
    }
    const current = metadata[binding.value.key];
    if (current !== undefined && normalizeReportText(String(current ?? '')) === expected) return binding;

    // `reportStatus` is a semantic phase value (`example`/`검토 필요`), while
    // the completed PDF may show a human label such as "과거 작성 예시".
    // Preserve that label as a phase record instead of freezing it as an
    // invariant; target execution will resolve the declared metadata key.
    if (binding.value.key === 'reportStatus' && metadata.reportPhase === 'example') {
      let text = phaseTextByValue.get(expected);
      if (!text || text.targetMetadataKey !== binding.value.key) {
        const key = binding.value.key.replace(/[^a-z0-9_-]+/giu, '_');
        let id = `${key || 'phase'}-example-${binding.slotId}`;
        let suffix = 2;
        while (existingIds.has(id)) id = `${key || 'phase'}-example-${binding.slotId}-${suffix++}`;
        text = { id, kind: 'phase', exampleValue: slot.exampleText, targetMetadataKey: binding.value.key };
        texts.push(text);
        phaseTextByValue.set(expected, text);
        existingIds.add(id);
      }
      changed = true;
      return { ...binding, value: { kind: 'text' as const, id: text.id } };
    }

    if (!sourceIdentityMetadataKey(binding.value.key) && !sourceIdentityWording(expected)) return binding;
    let text = textByValue.get(expected);
    if (!text) {
      const key = binding.value.key.replace(/[^a-z0-9_-]+/giu, '_');
      let id = `${key || 'source'}-example-${binding.slotId}`;
      let suffix = 2;
      while (existingIds.has(id)) id = `${key || 'source'}-example-${binding.slotId}-${suffix++}`;
      text = { id, kind: 'invariant', value: slot.exampleText };
      texts.push(text);
      textByValue.set(expected, text);
      existingIds.add(id);
    }
    changed = true;
    return { ...binding, value: { kind: 'text' as const, id: text.id } };
  });
  return changed
    ? { plan: { ...plan, texts }, layout: { ...layout, scalarBindings } }
    : { plan, layout };
}

function runtimePresentationMetadataKey(key: string): boolean {
  return /^(?:period|reportDate|httpSource|rdbSource|source\.)/u.test(key);
}

/**
 * Structured-output models frequently mark a source label or period heading as
 * invariant even though it contains a path or date. Convert only exact
 * matches to host-owned metadata tokens; an arbitrary numeric sentence still
 * fails closed in the reusable-plan validator.
 */
export function repairReportMetadataTextReferences(
  plan: ReportPlan,
  metadata: Record<string, ReportPrimitive>,
): ReportPlan {
  const candidates = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value: normalizeReportText(String(value)) }))
    .filter(({ value }) => value.length > 0);
  const priority = (key: string): number => (
    key === 'periodLabel' ? 0
      : key === 'periodRange' ? 1
        : key === 'reportDate' ? 2
          : key === 'httpSourceLabel' ? 3
            : key === 'rdbSourceLabel' ? 4
              : runtimePresentationMetadataKey(key) ? 10 : 20
  );
  let changed = false;
  const texts = plan.texts.map((text) => {
    if (text.kind === 'computed') return text;
    const value = text.kind === 'invariant' ? text.value : text.exampleValue;
    const keyCandidates = candidates
      .filter((candidate) => candidate.value === normalizeReportText(value))
      .filter((candidate) => /\d/u.test(value) || sourceIdentityWording(value) || runtimePresentationMetadataKey(candidate.key))
      .sort((left, right) => priority(left.key) - priority(right.key) || left.key.localeCompare(right.key));
    const key = keyCandidates[0]?.key;
    if (!key) return text;
    changed = true;
    return { id: text.id, kind: 'computed' as const, template: `{{meta.${key}}}` };
  });
  return changed ? { ...plan, texts } : plan;
}
