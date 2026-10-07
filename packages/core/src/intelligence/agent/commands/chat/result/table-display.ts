import { displayColumns, formatTableNumber } from '../../../../../contracts/artifacts/table-display.js';
import { boundedDisplayTable, MAX_DISPLAY_TABLE_COLUMNS, MAX_DISPLAY_TABLE_ROWS } from '../../../../../contracts/artifacts/table-bounds.js';
import type { TableArtifact } from '../../../../../contracts/artifacts/table.js';

function markdownCell(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value
    : typeof value === 'number' ? formatTableNumber(value)
      : JSON.stringify(value) ?? String(value);
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

const MAX_CHAT_TABLE_ROWS = MAX_DISPLAY_TABLE_ROWS;
const MAX_CHAT_TABLE_COLUMNS = MAX_DISPLAY_TABLE_COLUMNS;

function rdbPageWarning(table: TableArtifact): string | undefined {
  return table.readScope || table.coverage
    ? '이 결과는 페이지 조회이며 전체 데이터의 정확한 집계나 동일 시점의 스냅샷을 보장하지 않습니다.'
    : undefined;
}

export function tableToMarkdown(table: TableArtifact, requestedColumns?: readonly string[]): string {
  const allHeaders = displayColumns(
    table.columns.map((column) => column.name),
    requestedColumns,
  );
  const headers = allHeaders.slice(0, MAX_CHAT_TABLE_COLUMNS);
  const rows = table.rows.slice(0, MAX_CHAT_TABLE_ROWS);
  const coverageWarning = rdbPageWarning(table);
  if (headers.length === 0) return coverageWarning
    ? `현재 페이지의 조회 결과가 비어 있습니다.\n\n${coverageWarning}`
    : '조회 결과가 비어 있습니다.';
  const lines = [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => markdownCell(row.values[header])).join(' | ')} |`),
  ];
  if (headers.length < allHeaders.length) {
    lines.push('', `화면에는 전체 ${allHeaders.length}열 중 처음 ${headers.length}열만 표시했습니다.`);
  } else if (!requestedColumns?.length && headers.length < table.columns.length) {
    // Columns pruned for readability are disclosed so follow-ups never treat the view as complete.
    lines.push('', `화면에는 전체 ${table.columns.length}열 중 주요 ${headers.length}열만 표시했습니다.`);
  }
  if (rows.length < table.rows.length) {
    lines.push('', `화면에는 전체 ${table.rows.length}행 중 처음 ${rows.length}행만 표시했습니다.`);
  }
  if (table.completeness?.reason === 'provider_limit') {
    const page = table.completeness.observedCount;
    lines.push('', `API에서 전체 데이터 중 일부${page ? `(${page}행)` : ''}만 받았습니다. 필터·정렬·합계는 받은 행 안에서만 계산한 결과입니다.`);
  } else if (table.truncated || table.completeness?.status !== 'complete') {
    lines.push('', '응답이 일부만 포함되어 있습니다.');
  }
  if (coverageWarning) lines.push('', coverageWarning);
  return lines.join('\n');
}

export function formatTableArtifact(table: TableArtifact): string {
  return tableToMarkdown(table);
}

/** Keep only the bounded, visible table needed for an immediate follow-up. */
export const boundedChatReadResult = boundedDisplayTable;

export function rowsToMarkdown(rows: Record<string, unknown>[]): string {
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key);
      if (headerSet.size > MAX_CHAT_TABLE_COLUMNS) break;
    }
    if (headerSet.size > MAX_CHAT_TABLE_COLUMNS) break;
  }
  const allHeaders = [...headerSet];
  const headers = allHeaders.slice(0, MAX_CHAT_TABLE_COLUMNS);
  const displayedRows = rows.slice(0, MAX_CHAT_TABLE_ROWS);
  if (headers.length === 0) return '조회 결과가 비어 있습니다.';
  const lines = [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...displayedRows.map((row) => `| ${headers.map((header) => markdownCell(row[header])).join(' | ')} |`),
  ];
  if (allHeaders.length > headers.length) {
    lines.push('', `열이 많아 화면에는 처음 ${headers.length}열만 표시했습니다.`);
  }
  if (rows.length > displayedRows.length) {
    lines.push('', `화면에는 전체 ${rows.length}행 중 처음 ${displayedRows.length}행만 표시했습니다.`);
  }
  return lines.join('\n');
}

const SUMMARY_BOILERPLATE_COLUMNS = new Set([
  'images', 'thumbnail', 'photo', 'avatar', 'picture', 'icon',
  'reviews', 'dimensions', 'meta',
  'warrantyinformation', 'shippinginformation', 'returnpolicy',
  'minimumorderquantity', 'sku', 'barcode', 'qrcode', 'weight',
  'depth', 'width', 'height', 'createdat', 'updatedat', 'deletedat',
]);

/** Compact table artifact for LLM summary evidence, removing heavy nested columns and shortening long strings. */
export function compactSummaryTable(table: TableArtifact): TableArtifact {
  const hasScalarColumns = table.columns.some((col) =>
    ['string', 'number', 'integer', 'boolean', 'currency', 'percentage'].includes(col.type));

  let preservedColumns = table.columns;
  if (hasScalarColumns) {
    preservedColumns = table.columns.filter((col) => {
      const normalized = col.name.toLowerCase().replace(/[-_]/g, '');
      if (table.columns.length > 5 && SUMMARY_BOILERPLATE_COLUMNS.has(normalized)) {
        return false;
      }
      return !['images', 'thumbnail', 'reviews', 'dimensions', 'meta'].includes(normalized);
    });
  }

  const compactRows = table.rows.map((row) => {
    const newValues: TableArtifact['rows'][number]['values'] = {};
    for (const col of preservedColumns) {
      let val = row.values[col.name];
      if (typeof val === 'string') {
        const limit = preservedColumns.length > 6 ? 120 : 160;
        if (val.length > limit) {
          val = `${val.slice(0, limit)}...`;
        }
      }
      if (val === null || typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        newValues[col.name] = val;
      } else {
        newValues[col.name] = null;
      }
    }
    return { ...row, values: newValues };
  });

  return {
    ...table,
    columns: preservedColumns,
    rows: compactRows,
  };
}
