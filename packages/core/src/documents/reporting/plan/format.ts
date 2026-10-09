import type { ReportFormat, ReportPrimitive } from './schema.js';
import { numericValue } from './value.js';

export function formatReportValue(value: ReportPrimitive, format?: ReportFormat): string {
  if (value == null) return '';
  const style = format?.style ?? 'text';
  let display: string;
  switch (style) {
    case 'text':
    case 'date':
      display = String(value);
      break;
    case 'integer':
      // Same half-away-from-zero rounding as the decimal style (Math.round(-2.5) would give -2).
      display = numericValue(value, 'format.integer').toLocaleString('en-US', { maximumFractionDigits: 0 });
      break;
    case 'decimal':
      display = numericValue(value, 'format.decimal').toLocaleString('en-US', {
        minimumFractionDigits: format?.decimals ?? 2,
        maximumFractionDigits: format?.decimals ?? 2,
      });
      break;
    case 'currency':
      {
        const currency = format?.currency?.trim() ?? '';
        // A prefix or suffix ("$1,000", "8,466,900원", "KRW 1,000") already marks the currency the
        // way the report writes it; the code is added only to a bare number.
        const markedByAffix = Boolean(format?.prefix?.trim() || format?.suffix?.trim());
        display = `${markedByAffix || currency.length === 0 ? '' : `${currency} `}${numericValue(value, 'format.currency').toLocaleString('en-US', {
          minimumFractionDigits: format?.decimals ?? 0,
          maximumFractionDigits: format?.decimals ?? 0,
        })}`.trim();
      }
      break;
    case 'percent':
      display = `${(numericValue(value, 'format.percent') * 100).toLocaleString('en-US', {
        minimumFractionDigits: format?.decimals ?? 2,
        maximumFractionDigits: format?.decimals ?? 2,
      })}%`;
      break;
  }
  return `${format?.prefix ?? ''}${display}${format?.suffix ?? ''}`;
}
