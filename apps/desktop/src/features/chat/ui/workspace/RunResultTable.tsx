import type { WorkspaceChatMessage } from '@ax-studio/core';
import { formatTableNumber } from '@ax-studio/core/table-display';

type ResultTable = NonNullable<WorkspaceChatMessage['readResult']>;

function cellText(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'number' ? formatTableNumber(value) : String(value);
}

/** The table a run made, under its result card; notes say when it is only part of the data. */
export function RunResultTable({ table }: { table: ResultTable }) {
  const columns = table.columns.map((column) => column.label ?? column.name);
  const page = table.completeness?.reason === 'provider_limit' ? table.completeness.observedCount : undefined;
  return (
    <section className="ax-run-result-table" aria-label="실행 결과 표">
      {table.rows.length === 0 ? (
        <p className="ax-run-result-table-note">조건에 맞는 행이 없습니다.</p>
      ) : (
        <div className="ax-run-result-table-scroll">
          <table>
            <thead>
              <tr>{columns.map((name, index) => <th key={index} scope="col">{name}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {table.columns.map((column, index) => <td key={index}>{cellText(row.values[column.name])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.truncated && <p className="ax-run-result-table-note">표가 길어 앞부분만 보여 줍니다.</p>}
      {table.completeness?.reason === 'provider_limit' && (
        <p className="ax-run-result-table-note">
          API가 전체 데이터 중 한 페이지{page ? `(${page}행)` : ''}만 돌려줬습니다. 이 표는 그 페이지 안에서 만든 결과입니다.
        </p>
      )}
    </section>
  );
}
