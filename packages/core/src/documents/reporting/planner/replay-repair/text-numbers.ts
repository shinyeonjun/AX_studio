import type { ReportPlan } from '../../plan/schema.js';
import { executeReportPlan } from '../../plan/execute.js';
import { formatFromExampleText, type ReplayRepairInput, type ReplayRepairResult } from './shared.js';

const NUMBER = /[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[+-]?\d+(?:\.\d+)?/gu;

/**
 * A scalar written inside a sentence takes the sentence's own way of writing it: the example says
 * "8,466,900원이며" around {{scalar.total}}원, so the scalar is the bare number, not "KRW 8,466,900".
 * The format comes from the example's digits for the scalar's own value; the replay keeps it only
 * when it helps.
 */
export function applyTextNumberFormatVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  let result;
  try {
    result = executeReportPlan(input.plan, input.sources, input.metadata);
  } catch {
    return [];
  }
  const slots = new Map(input.pair.scalarSlots.map((slot) => [slot.id, slot]));
  const bad = new Set(current.mismatches.map((mismatch) => mismatch.slotId));
  const variants: ReplayRepairInput[] = [];
  for (const binding of input.layout.scalarBindings) {
    const slot = slots.get(binding.slotId);
    if (!slot || !bad.has(slot.id) || binding.value.kind !== 'text') continue;
    const textId = binding.value.id;
    const text = input.plan.texts.find((item) => item.id === textId);
    if (text?.kind !== 'computed') continue;
    for (const match of text.template.matchAll(/\{\{\s*scalar\.([^{}|\s]+)\s*\}\}/gu)) {
      const scalarId = match[1]!;
      const scalar = result.scalars[scalarId];
      if (!scalar || typeof scalar.raw !== 'number' || slot.exampleText.includes(scalar.display)) continue;
      const raw = scalar.raw;
      const written = [...slot.exampleText.matchAll(NUMBER)].map((found) => found[0])
        .find((digits) => {
          const value = Number(digits.replace(/,/gu, ''));
          const decimals = digits.split('.')[1]?.length ?? 0;
          return Math.abs(value - Number(raw.toFixed(decimals))) < 10 ** -decimals / 2 + 1e-9;
        });
      const format = written === undefined ? undefined : formatFromExampleText(written);
      if (!format) continue;
      const scalars: ReportPlan['scalars'] = input.plan.scalars
        .map((item) => (item.id === scalarId ? { ...item, format } : item));
      variants.push({ ...input, plan: { ...input.plan, scalars } });
    }
  }
  return variants;
}
