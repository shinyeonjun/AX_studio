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
      display = Math.round(numericValue(value, 'format.integer')).toLocaleString('en-US');
      break;
    case 'decimal':
      display = numericValue(value, 'format.decimal').toLocaleString('en-US', {
        minimumFractionDigits: format?.decimals ?? 2,
        maximumFractionDigits: format?.decimals ?? 2,
      });
      break;
    case 'currency':
      display = `${format?.currency ?? ''} ${numericValue(value, 'format.currency').toLocaleString('en-US', {
        minimumFractionDigits: format?.decimals ?? 0,
        maximumFractionDigits: format?.decimals ?? 0,
      })}`.trim();
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
