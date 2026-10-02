import * as XLSX from 'xlsx';
import { TableArtifactSchema } from '../../../contracts/artifacts/table.js';
import type { ConnectorContext, ConnectorResult } from '../../types.js';

/** Host-owned durable output; no caller-supplied path and no formula interpretation. */
export function tableToXlsx(input: unknown, ctx: ConnectorContext): ConnectorResult {
  ctx.abortSignal?.throwIfAborted();
  const parsed = TableArtifactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errorCode: 'table_input_invalid', error: '표 입력을 확인할 수 없습니다.' };
  if (!ctx.artifactSink) return { ok: false, errorCode: 'xlsx_artifact_store_unavailable', error: '파일 저장소가 준비되지 않았습니다.' };
  const table = parsed.data;
  if (!table.columns.length || table.columns.length > 256 || table.rows.length > 100_000
    || table.columns.length * table.rows.length > 1_000_000
    || new Set(table.columns.map(c => c.name)).size !== table.columns.length
    || table.rows.some(row => table.columns.some(c => {
      const value = row.values[c.name];
      return value === undefined || (typeof value === 'number' && !Number.isFinite(value))
        || (typeof value === 'string' && value.length > 32_767);
    }))) return { ok: false, errorCode: 'xlsx_table_limit_or_shape', error: 'Excel의 표 크기 또는 셀 형식 제한을 확인해 주세요.' };
  try {
    // Strings remain literal s cells, including =, +, -, @ and URLs. No f/l fields are created.
    const matrix = [table.columns.map(c => c.name), ...table.rows.map(row => table.columns.map(c => row.values[c.name]))];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(matrix), 'Data');
    const partial = table.truncated || (table.completeness && table.completeness.status !== 'complete');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['scope', 'current table only'], ['rows', table.rows.length],
      ['source completeness', partial ? 'partial or unknown; not the entire source' : 'current table'],
    ]), 'Export info');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
    ctx.abortSignal?.throwIfAborted();
    const stored = ctx.artifactSink.putBytes(bytes, { fileName: 'table.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    // Whitelist metadata: an ArtifactStore implementation may return a physical storedPath.
    const artifact = { id: stored.id, fileName: stored.fileName, sha256: stored.sha256, size: stored.size,
      mimeType: stored.mimeType, createdAt: stored.createdAt };
    ctx.log({ at: new Date().toISOString(), level: 'info', code: 'xlsx_generated',
      message: '현재 표를 Excel 파일로 저장했습니다.', data: { artifactId: artifact.id, fileName: artifact.fileName,
        size: artifact.size, mimeType: artifact.mimeType, rowCount: table.rows.length, partial: Boolean(partial) } });
    return { ok: true, data: { artifact: { value: artifact } } };
  } catch (error) {
    ctx.abortSignal?.throwIfAborted();
    return { ok: false, errorCode: 'xlsx_artifact_store_failed', error: 'Excel 파일을 생성하거나 저장하지 못했습니다.' };
  }
}
