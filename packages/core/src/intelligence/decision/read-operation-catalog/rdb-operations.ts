import type { SourceListingConnection } from '../../../connectors/types.js';
import { addIndexedOperation, type IndexedReadOperation } from './indexed-operation.js';
import { asRecord, limitParameterHint, text } from './request-values.js';

export function addRdbOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  const config = asRecord(connection.config);
  if (!config) return;
  const connectionLabel = text(config.label, 100);
  const tables = Array.isArray(config.allowedTables)
    ? config.allowedTables.filter((table): table is string => typeof table === 'string' && Boolean(table.trim()))
    : [];
  if (tables.length > 0) {
    addIndexedOperation(operations, {
      capabilityId: 'rdb.schema.describe',
      connector: 'rdb',
      ...(connectionLabel ? { sourceLabel: connectionLabel } : {}),
      label: connectionLabel ? `${connectionLabel} 스키마` : 'DB 스키마',
      description: connectionLabel
        ? `${connectionLabel}의 허용된 테이블 목록 및 DB 스키마 구조 조회 (테이블 구조 확인 전용)`
        : '허용된 DB 테이블 목록 및 스키마 구조 조회 (테이블 구조 확인 전용)',
    }, () => ({ params: {} }));
  }
  for (const table of tables) {
    const safeTable = table.slice(0, 160);
    addIndexedOperation(operations, {
      capabilityId: 'rdb.query.read',
      connector: 'rdb',
      ...(connectionLabel ? { sourceLabel: connectionLabel } : {}),
      label: `DB 조회: ${safeTable}`,
      description: `허용된 테이블 ${safeTable} 읽기`,
    }, (userMessage) => ({
      params: { table },
      parameterHints: [limitParameterHint('limit', userMessage, 'Maximum number of rows to return.')],
    }));
  }
}
