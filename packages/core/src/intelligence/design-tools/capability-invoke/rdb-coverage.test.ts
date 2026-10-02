import { describe, expect, it } from 'vitest';
import { boundCapabilityEvidence, capabilityPagingMetadata } from '../capability-invoke.js';
import { tableArtifactFromRows } from '../../../contracts/artifacts/table-build.js';
import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import { boundedChatReadResult, formatTableArtifact } from '../../agent/commands/chat/result.js';

function rdbTable(rowCount: number): TableArtifact {
  const table = tableArtifactFromRows(Array.from({ length: rowCount }, (_, id) => ({
    id, text: 'large row '.repeat(500),
  })), { id: 'rdb-evidence', preserveRawValues: true, scalarPolicy: 'preserve', rowLimit: 1000 })!;
  return { ...table, offset: 1000,
    readScope: { schemaVersion: 1, kind: 'page', queryFingerprint: 'a'.repeat(64), table: 'facts',
      accessMode: 'read_only', projection: 'all_columns', predicate: 'none', pagination: 'offset',
      scalarPolicy: 'preserve', offset: 1000, limit: 1000 },
    coverage: { schemaVersion: 1, page: 'complete', query: 'partial', source: 'partial',
      consistency: 'best_effort', reason: 'independent_offset_reads', observedRows: rowCount, hasMore: false },
  };
}

describe('RDB coverage at bounded consumer seams', () => {
  it('reserves full query identity/coverage before large row evidence consumes the model budget', () => {
    const table = rdbTable(200);
    const result = boundCapabilityEvidence({ capabilityId: 'rdb.query.read', data: table, citations: [], untrusted: true });
    expect(result.data).toMatchObject({ offset: 1000, readScope: table.readScope, coverage: table.coverage });
    expect(result.evidence).toMatchObject({ truncated: true, reason: 'model_evidence_limit' });
    expect((result.data as TableArtifact).rows.length).toBeLessThan(table.rows.length);
    expect((result.data as TableArtifact).coverage?.observedRows).toBe(200);
  });

  it('rejects half or forged exact RDB coverage instead of silently dropping the warning', () => {
    const table = rdbTable(1);
    expect(() => capabilityPagingMetadata({ kind: 'table', readScope: table.readScope }))
      .toThrow('capability_rdb_read_metadata_invalid');
    expect(() => capabilityPagingMetadata({ kind: 'table', readScope: table.readScope,
      coverage: { ...table.coverage, source: 'complete', consistency: 'verified_snapshot' } }))
      .toThrow('capability_rdb_read_metadata_invalid');
  });

  it('never shortens an over-budget RDB query/page identity', () => {
    const table = rdbTable(1);
    expect(() => capabilityPagingMetadata({ kind: 'table', readScope: { ...table.readScope, table: 'a'.repeat(9000) }, coverage: table.coverage }))
      .toThrow('capability_paging_metadata_too_large');
  });

  it('retains upstream coverage and offsets in the bounded follow-up table', () => {
    const table = rdbTable(101);
    // Keep this fixture beneath the existing 64 KB follow-up bound.
    table.rows.forEach(row => { row.values.text = ''; row.rawValues!.text = ''; });
    const bounded = boundedChatReadResult(table);
    expect(bounded).toMatchObject({ offset: 1000, truncated: true,
      readScope: table.readScope, coverage: table.coverage });
    expect(bounded?.rows).toHaveLength(100);
    expect(bounded?.coverage?.observedRows).toBe(101);
  });

  it('makes last-page and empty-page limitations visible while keeping legacy tables compatible', () => {
    const table = rdbTable(1);
    expect(formatTableArtifact(table)).toContain('전체 데이터의 정확한 집계나 동일 시점의 스냅샷을 보장하지 않습니다');
    expect(formatTableArtifact(rdbTable(0))).toContain('현재 페이지의 조회 결과가 비어 있습니다');
    const { readScope: _scope, coverage: _coverage, ...legacy } = table;
    expect(formatTableArtifact(legacy)).not.toContain('스냅샷');
    expect(capabilityPagingMetadata({ completeness: { status: 'complete', hasMore: false }, nextOffset: 2 }))
      .toEqual({ nextOffset: 2, completeness: { status: 'complete', hasMore: false } });
    expect(capabilityPagingMetadata({ coverage: { unrelated: 'API business data' } })).toEqual({});
  });
});
