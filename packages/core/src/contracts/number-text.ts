/**
 * A number as people write it in a cell: thousands separators, a currency sign or 원, a percent
 * sign (50% -> 50, as shown) and accounting negatives ((1,000) -> -1000). Blank text, hex and
 * other non-decimal forms are not numbers.
 */
export function parseWrittenNumber(value: string): number | null {
  let text = value.trim().replace(/,/g, '').replace(/^[₩$€£¥]\s*/u, '').replace(/\s*(원|%)$/u, '').trim();
  let negative = false;
  if (/^\(.*\)$/u.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/iu.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}
