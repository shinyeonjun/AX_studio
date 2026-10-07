import type { WorkspaceChatMessage } from '@ax-studio/core';
import { ToolHeader } from './ToolHeader';

export function DatabaseResult({ message }: { message: WorkspaceChatMessage }) {
  const table = message.readResult!;
  const scope = table.readScope!;
  const origin = table.source;
  const brand = origin?.database === 'postgres' ? 'PostgreSQL' : origin?.database === 'mysql' ? 'MySQL' : origin?.database === 'sqlite' ? 'SQLite' : 'DB';
  const verified = origin?.readOnlyEnforced === true && origin.queryFingerprint === scope.queryFingerprint && !!origin.executionId
    && (!message.executionId || message.executionId === origin.executionId);
  return <section className="tool-result-pane tool-result-pane--db" aria-label="DB 조회 결과">
    <ToolHeader tool="rdb" title={brand + ' · 조회 결과'} badge={verified ? '읽기 전용' : '조회 결과 · 검증 정보 없음'} />
    <p className="tool-result-destination"><span>조회 당시 연결</span><strong>{origin?.database ? brand + ' · 연결 이름 미기록' : '이 결과의 연결 정보 없음'}</strong></p>
    <div className="tool-result-table-summary"><h3>{table.name ?? scope.table}</h3><p><strong>{table.rows.length}</strong>행 표시</p>
      <small>현재 조회 페이지 · 전체 데이터 개수는 확인되지 않았습니다.</small></div>
    <div className="tool-result-table-scroll" tabIndex={0} role="region" aria-label="조회 결과 표">
      <table><caption className="tool-result-table-caption">{scope.table} 조회 결과</caption>
        <thead><tr>{table.columns.map(column => <th scope="col" key={column.name}>{column.label ?? column.name}</th>)}</tr></thead>
        <tbody>{table.rows.map(row => <tr key={row.index}>{table.columns.map(column => <td key={column.name}>{row.values[column.name] === null ? <span className="tool-result-null">NULL</span> : String(row.values[column.name] ?? '')}</td>)}</tr>)}</tbody>
      </table>
      {table.rows.length === 0 && <p className="tool-result-empty">이 페이지에서 조회된 행이 없습니다.</p>}
    </div>
    <details className="tool-result-details"><summary>조회 조건 및 SQL 정보</summary>
      <dl><dt>테이블</dt><dd>{scope.table}</dd>{scope.joins?.length ? <><dt>함께 읽은 테이블</dt><dd>{scope.joins.map(join => `${join.table} (${join.on} = ${join.references})`).join(', ')}</dd></> : null}<dt>조건</dt><dd>조건 필터 없음 · 전체 열</dd><dt>페이지</dt><dd>시작 {scope.offset} · 최대 {scope.limit}행</dd>
        <dt>조회 시점</dt><dd>{origin?.capturedAt ?? '정보 없음'}</dd><dt>조회 식별값</dt><dd>{scope.queryFingerprint}</dd></dl>
      <p>실행 SQL은 이 결과에 포함되지 않았습니다. 직접 SQL 입력과 DB 수정은 지원되지 않습니다.</p>
      {(table.truncated || table.coverage?.hasMore) && <p>추가 페이지가 있습니다. 대화에서 이어서 조회할 수 있습니다.</p>}
      <p>페이지 간 데이터는 바뀔 수 있습니다. 현재 연결 설정이 이 조회 결과의 출처를 바꾸지 않습니다.</p>
    </details>
    <footer className="tool-result-footer"><span>추가 조회와 분석 요청은 대화에서 입력할 수 있습니다.</span></footer>
  </section>;
}
