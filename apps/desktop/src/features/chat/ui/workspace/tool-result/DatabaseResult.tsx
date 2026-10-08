import type { TableArtifact, WorkspaceChatMessage } from '@ax-studio/core';
import { formatTableNumber } from '@ax-studio/core/table-display';
import { formatTimestamp } from '../../../../activity/ui/format';
import { ToolHeader } from './ToolHeader';

function cellText(value: unknown): string {
  return typeof value === 'number' ? formatTableNumber(value) : String(value ?? '');
}

/**
 * What the shown rows are, in plain words and without inventing a total: how many rows the read
 * returned, whether the database said there were more, and whether the chat narrowed them.
 */
function rowsNote(table: TableArtifact): string {
  const read = table.coverage?.observedRows;
  const narrowed = read !== undefined && read !== table.rows.length
    ? `가져온 ${formatTableNumber(read)}행 중 조건에 맞는 행만 보여 줘요.`
    : undefined;
  const more = table.coverage?.hasMore || table.truncated
    ? '아직 가져오지 않은 행이 더 있어요.'
    : table.coverage ? '더 가져올 행은 없었어요.' : undefined;
  return [narrowed, more].filter(Boolean).join(' ');
}

export function DatabaseResult({ message }: { message: WorkspaceChatMessage }) {
  const table = message.readResult!;
  const scope = table.readScope!;
  const origin = table.source;
  const brand = origin?.database === 'postgres' ? 'PostgreSQL' : origin?.database === 'mysql' ? 'MySQL' : origin?.database === 'sqlite' ? 'SQLite' : 'DB';
  const verified = origin?.readOnlyEnforced === true && origin.queryFingerprint === scope.queryFingerprint && !!origin.executionId
    && (!message.executionId || message.executionId === origin.executionId);
  return <section className="tool-result-pane tool-result-pane--db" aria-label="DB 조회 결과">
    <ToolHeader tool="rdb" title={brand + ' · 조회 결과'} badge={verified ? '읽기 전용' : '조회 결과'} />
    {origin?.database && <p className="tool-result-destination"><span>읽은 곳</span><strong>{origin.connectionLabel ? `${origin.connectionLabel} (${brand})` : brand}</strong></p>}
    <div className="tool-result-table-summary"><h3>{table.name ?? scope.table}</h3><p><strong>{formatTableNumber(table.rows.length)}</strong>행 표시</p>
      {rowsNote(table) && <small>{rowsNote(table)}</small>}</div>
    <div className="tool-result-table-scroll" tabIndex={0} role="region" aria-label="조회 결과 표">
      <table><caption className="tool-result-table-caption">{scope.table} 조회 결과</caption>
        <thead><tr>{table.columns.map(column => <th scope="col" key={column.name}>{column.label ?? column.name}</th>)}</tr></thead>
        <tbody>{table.rows.map(row => <tr key={row.index}>{table.columns.map(column => <td key={column.name}>{row.values[column.name] === null ? <span className="tool-result-null">NULL</span> : cellText(row.values[column.name])}</td>)}</tr>)}</tbody>
      </table>
      {table.rows.length === 0 && <p className="tool-result-empty">가져온 행이 없습니다.</p>}
    </div>
    <details className="tool-result-details"><summary>조회 정보</summary>
      <dl><dt>표</dt><dd>{scope.table}</dd>{scope.joins?.length ? <><dt>함께 읽은 표</dt><dd>{[...new Set(scope.joins.map(join => join.table))].join(', ')}</dd></> : null}<dt>한 번에 가져오는 양</dt><dd>최대 {scope.limit}행</dd>
        <dt>조회 시점</dt><dd>{origin?.capturedAt ? formatTimestamp(origin.capturedAt) : '정보 없음'}</dd></dl>
      <p>데이터베이스의 내용을 읽기만 했습니다. 이 화면에서는 데이터베이스 내용을 바꿀 수 없습니다.</p>
      {(table.truncated || table.coverage?.hasMore) && <p>아직 가져오지 않은 행이 더 있습니다. 대화에서 이어서 가져와 달라고 요청할 수 있습니다.</p>}
      <p>이어서 가져오는 사이 데이터가 바뀔 수 있습니다. 나중에 연결 설정을 바꿔도 이 결과의 출처는 그대로입니다.</p>
    </details>
    <footer className="tool-result-footer"><span>추가 조회와 분석 요청은 대화에서 입력할 수 있습니다.</span></footer>
  </section>;
}
