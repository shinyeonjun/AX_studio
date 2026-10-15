import type { DecisionMode, DecisionUsageComparison, DecisionUsageSummary } from './contracts';

interface UsageCompareTableProps {
  usage: DecisionUsageComparison;
  activeMode: DecisionMode;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}초`;
const count = (value: number) => Math.round(value).toLocaleString('ko-KR');
const usd = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;

const ROWS: Array<{ label: string; value: (usage: DecisionUsageSummary) => string; lowerIsBetter: (usage: DecisionUsageSummary) => number }> = [
  { label: '판단한 요청', value: (u) => `${count(u.requests)}건`, lowerIsBetter: () => 0 },
  { label: '판단 시간 (중간값)', value: (u) => seconds(u.p50Ms), lowerIsBetter: (u) => u.p50Ms },
  { label: '판단 시간 (느린 5%)', value: (u) => seconds(u.p95Ms), lowerIsBetter: (u) => u.p95Ms },
  { label: '요청당 호출 수', value: (u) => u.callsPerRequest.toFixed(1), lowerIsBetter: (u) => u.callsPerRequest },
  { label: '요청당 입력 토큰', value: (u) => count(u.inputTokensPerRequest), lowerIsBetter: (u) => u.inputTokensPerRequest },
  { label: '요청당 출력 토큰', value: (u) => count(u.outputTokensPerRequest), lowerIsBetter: (u) => u.outputTokensPerRequest },
  { label: '비용 (기간 합계)', value: (u) => usd(u.costUsd), lowerIsBetter: (u) => u.costUsd },
  { label: '1000건당 비용', value: (u) => usd(u.requests ? (u.costUsd / u.requests) * 1000 : 0), lowerIsBetter: (u) => (u.requests ? u.costUsd / u.requests : 0) },
];

/** Jev and LLM decision usage side by side; the cheaper or faster value of each row is marked. */
export function UsageCompareTable({ usage, activeMode }: UsageCompareTableProps) {
  const { jev, llm } = usage;
  const better = (row: (typeof ROWS)[number]): DecisionMode | null => {
    if (!jev || !llm) return null;
    const a = row.lowerIsBetter(jev);
    const b = row.lowerIsBetter(llm);
    if (a === b) return null;
    return a < b ? 'jev' : 'llm';
  };

  if (!jev && !llm) return <p className="muted decision-usage-empty">이 기간에 기록된 판단이 없어요.</p>;
  return (
    <table className="decision-usage-table">
      <thead>
        <tr>
          <th scope="col">항목</th>
          <th scope="col">Jev{activeMode === 'jev' && <span className="decision-usage-active">사용 중</span>}</th>
          <th scope="col">LLM{activeMode === 'llm' && <span className="decision-usage-active">사용 중</span>}</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => {
          const winner = better(row);
          return (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className={winner === 'jev' ? 'better' : ''}>{jev ? row.value(jev) : '–'}</td>
              <td className={winner === 'llm' ? 'better' : ''}>{llm ? row.value(llm) : '–'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
