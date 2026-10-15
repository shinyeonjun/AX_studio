import { useEffect, useState } from 'react';
import type { UsageReport } from '@ax-studio/core';
import type { AppState } from '../../../types/app-state';
import { PageHeader } from '../../../ui/layout/PageHeader';
import { ipcErrorMessage } from '../../../ui/lib/ipc-error';
import { USAGE_PERIOD_LABELS, type UsagePeriod, type UsageSummary } from './contracts';
import { ShareDonut } from './ShareDonut';
import { UsageCompareTable } from './UsageCompareTable';

interface UsagePageProps {
  state: AppState | null;
}

const usd = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const duration = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}분` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}초`);
const tokens = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1000).toLocaleString('ko-KR')}K`;
  return Math.round(value).toLocaleString('ko-KR');
};
const totalTokens = (usage: UsageSummary) => usage.requests * (usage.inputTokensPerRequest + usage.outputTokensPerRequest);

/** How much time, tokens and money the app's model calls took, Jev against the LLM. */
export function UsagePage({ state }: UsagePageProps) {
  const [period, setPeriod] = useState<UsagePeriod>('week');
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    void window.ax.getUsageReport(period)
      .then((next) => { if (!cancelled) setReport(next); })
      .catch((reason) => { if (!cancelled) setError(ipcErrorMessage(reason, '사용량을 읽지 못했어요.')); });
    return () => { cancelled = true; };
  }, [period]);

  const activeMode = state?.decisionEngineKind === 'jev' ? 'jev' : 'llm';
  const decision = report?.decision;
  const pick = (read: (usage: UsageSummary) => number) => ({
    ...(decision?.jev ? { jev: read(decision.jev) } : {}),
    ...(decision?.llm ? { llm: read(decision.llm) } : {}),
  });
  const unpriced = (decision?.jev?.unpricedCalls ?? 0) + (decision?.llm?.unpricedCalls ?? 0);
  const generation = report?.generation;

  return (
    <>
      <PageHeader
        title="사용량"
        subtitle="요청 판단과 답변 작성에 쓴 시간·토큰·비용을 봅니다"
        action={(
          <div className="decision-usage-periods" role="group" aria-label="기간">
            {(Object.keys(USAGE_PERIOD_LABELS) as UsagePeriod[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`decision-usage-period ${period === key ? 'active' : ''}`}
                aria-pressed={period === key}
                onClick={() => setPeriod(key)}
              >
                {USAGE_PERIOD_LABELS[key]}
              </button>
            ))}
          </div>
        )}
      />
      <div className="page-content usage-page">
        {error && <div className="approval-error" role="alert">{error}</div>}
        {!report && !error && <p className="muted">사용량을 불러오는 중…</p>}

        {report && (
          <>
            <section className="settings-section decision-usage">
              <h4>요청 판단</h4>
              {decision?.jev || decision?.llm ? (
                <>
                  <div className="usage-donuts" aria-label="Jev와 LLM의 몫">
                    <ShareDonut title="판단 비용" values={pick((u) => u.costUsd)} format={usd} />
                    <ShareDonut title="판단 시간" values={pick((u) => u.totalMs)} format={duration} />
                    <ShareDonut title="토큰" values={pick(totalTokens)} format={tokens} />
                  </div>
                  <h4 className="usage-subheading">요청 한 건 기준</h4>
                  <UsageCompareTable usage={report.decision} activeMode={activeMode} />
                  {unpriced > 0 && <p className="muted decision-usage-note">가격이 등록되지 않은 모델의 호출 {unpriced}건은 비용에서 빠졌어요.</p>}
                </>
              ) : (
                <p className="muted decision-usage-empty">이 기간에 기록된 판단이 없어요. 대화에서 요청하면 여기에 쌓입니다.</p>
              )}
              <p className="muted decision-usage-note">
                두 방식을 번갈아 쓰면 서로 다른 요청을 판단한 값이라 그대로 비교하기 어려워요. 같은 요청끼리 비교하려면 설정 → 요청 판단에서 "함께 판단해서 비교"를 켜 주세요.
              </p>
            </section>

            <section className="settings-section decision-usage">
              <h4>답변 작성 (연결된 AI)</h4>
              {generation ? (
                <dl className="usage-kpis">
                  <div><dt>호출</dt><dd>{generation.calls.toLocaleString('ko-KR')}건</dd></div>
                  <div><dt>시간 (요청당 중간값)</dt><dd>{duration(generation.p50Ms)}</dd></div>
                  <div><dt>토큰</dt><dd>{generation.callsWithTokens === 0 ? '알 수 없음' : tokens(totalTokens(generation))}</dd></div>
                  <div>
                    <dt>비용</dt>
                    <dd>{generation.unpricedCalls === generation.calls ? '가격 미등록' : usd(generation.costUsd)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="muted decision-usage-empty">이 기간에 AI가 쓴 답변이 없어요.</p>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
