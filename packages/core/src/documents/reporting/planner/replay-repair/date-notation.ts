import type { ReportLayoutPlan } from '../../layout/schema.js';
import type { ReportPlan, ReportPrimitive } from '../../plan/schema.js';
import { executeReportPlan } from '../../plan/execute.js';
import { renderReportTextTemplate } from '../../plan/text-tokens.js';
import { dateMentions, type DateMention } from '../../period-mentions.js';
import type { ReplayRepairInput, ReplayRepairResult } from './shared.js';

const ISO = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u;

/** The pattern that writes `mention` from its parts: "2026.08.01" → "YYYY.MM.DD", "8월" → "M월". */
function notationOf(mention: DateMention): string | undefined {
  let rest = mention.text;
  let pattern = '';
  const take = (value: number | undefined, long: string, short: string, width: number): boolean => {
    if (value === undefined) return true;
    const padded = String(value).padStart(width, '0');
    const index = rest.search(/\d/u);
    if (index < 0) return false;
    pattern += rest.slice(0, index);
    rest = rest.slice(index);
    if (rest.startsWith(padded) && !/^\d/u.test(rest.slice(padded.length))) {
      pattern += long;
      rest = rest.slice(padded.length);
      return true;
    }
    const plain = String(value);
    if (rest.startsWith(plain) && !/^\d/u.test(rest.slice(plain.length))) {
      pattern += short;
      rest = rest.slice(plain.length);
      return true;
    }
    return false;
  };
  if (!take(mention.year, 'YYYY', 'YYYY', 4) || !take(mention.month, 'MM', 'M', 2) || !take(mention.day, 'DD', 'D', 2)) return undefined;
  // What follows the last part is literal: it may not hold a digit or a letter the pattern reads.
  return /\d|[YMD]/u.test(rest) ? undefined : pattern + rest;
}

/** A date-valued metadata key that names the mentioned day (or month). */
function metadataDateKey(mention: DateMention, metadata: Record<string, ReportPrimitive>): string | undefined {
  for (const [key, value] of Object.entries(metadata)) {
    const match = typeof value === 'string' ? ISO.exec(value) : null;
    if (!match) continue;
    const [, year, month, day] = match;
    if (Number(month) !== mention.month) continue;
    if (mention.year !== undefined && Number(year) !== mention.year) continue;
    if (mention.day !== undefined && Number(day ?? NaN) !== mention.day) continue;
    if (mention.day === undefined && day !== undefined && Number(day) !== 1) continue;
    return key;
  }
  return undefined;
}

/**
 * Write the example's text from tokens the text already used, with its dates written the way the
 * example writes them. Nothing of the example is kept but the words between values: a literal
 * with a digit in it is refused, so no period or number is frozen into the plan.
 */
function retemplate(
  expected: string,
  tokens: Array<{ token: string; rendered: string }>,
  metadata: Record<string, ReportPrimitive>,
): string | undefined {
  let template = '';
  let cursor = 0;
  for (const mention of dateMentions(expected)) {
    const start = expected.indexOf(mention.text, cursor);
    const key = metadataDateKey(mention, metadata);
    const pattern = notationOf(mention);
    if (start < 0 || !key || !pattern) return undefined;
    template += expected.slice(cursor, start) + `{{meta.${key}|${pattern}}}`;
    cursor = start + mention.text.length;
  }
  template += expected.slice(cursor);
  for (const { token, rendered } of [...tokens].sort((left, right) => right.rendered.length - left.rendered.length)) {
    if (!rendered || /^\{\{/u.test(rendered)) continue;
    template = template.split(/(\{\{[^{}]+\}\})/u)
      .map((part) => (part.startsWith('{{') ? part : part.split(rendered).join(`{{${token}}}`)))
      .join('');
  }
  const literal = template.replace(/\{\{[^{}]+\}\}/gu, '');
  return /\d/u.test(literal) ? undefined : template;
}

export function applyDateNotationVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  let result;
  try {
    result = executeReportPlan(input.plan, input.sources, input.metadata);
  } catch {
    return [];
  }
  const values = { ...result, metadata: input.metadata };
  const slots = new Map(input.pair.scalarSlots.map((slot) => [slot.id, slot]));
  const bad = new Set(current.mismatches.map((mismatch) => mismatch.slotId));
  const variants: ReplayRepairInput[] = [];
  for (const binding of input.layout.scalarBindings) {
    const slot = slots.get(binding.slotId);
    if (!slot || !bad.has(slot.id) || dateMentions(slot.exampleText).length === 0) continue;
    const text = binding.value.kind === 'text'
      ? input.plan.texts.find((item) => item.id === (binding.value as { id: string }).id)
      : undefined;
    const used = binding.value.kind === 'metadata' ? [`meta.${binding.value.key}`]
      : binding.value.kind === 'scalar' ? [`scalar.${binding.value.id}`]
        : text?.kind === 'computed' ? [...text.template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu)].map((match) => match[1]!.trim()) : [];
    const tokens = used.flatMap((token) => {
      try {
        return [{ token, rendered: renderReportTextTemplate(`{{${token}}}`, values) }];
      } catch {
        return [];
      }
    });
    const template = retemplate(slot.exampleText, tokens, input.metadata);
    if (!template) continue;
    const id = text?.kind === 'computed' ? text.id : `date-text-${slot.id}`;
    const texts: ReportPlan['texts'] = text?.kind === 'computed'
      ? input.plan.texts.map((item) => (item.id === id ? { id, kind: 'computed', template } : item))
      : [...input.plan.texts, { id, kind: 'computed', template }];
    const layout: ReportLayoutPlan = {
      ...input.layout,
      scalarBindings: input.layout.scalarBindings.map((item) => (item.slotId === slot.id
        ? { ...item, value: { kind: 'text', id } } : item)),
    };
    variants.push({ ...input, plan: { ...input.plan, texts }, layout });
  }
  return variants;
}
