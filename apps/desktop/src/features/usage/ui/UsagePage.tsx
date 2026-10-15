import { useState } from 'react';
import type { AppState } from '../../../types/app-state';
import { PageHeader } from '../../../ui/layout/PageHeader';
import { SAMPLE_USAGE, USAGE_PERIOD_LABELS, type DecisionUsageSummary, type UsagePeriod } from './contracts';
import { ShareDonut } from './ShareDonut';
import { UsageCompareTable } from './UsageCompareTable';

interface UsagePageProps {
  state: AppState | null;
}

const usd = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const duration = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}분` : `${(ms / 1000).toFixed(0)}초`);
const tokens = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1000).toLocaleString('ko-KR')}K`);
const totalTokens = (usage: DecisionUsageSummary) => usage.requests * (usage.inputTokensPerRequest + usage.outputTokensPerRequest);

/** How much time, tokens and money request decisions took, Jev against the LLM. */
export function UsagePage({ state }: UsagePageProps) {
  const [period, setPeriod] = useState<UsagePeriod>('week');
  // Until usage is recorded per request, every period shows the same labelled example.
  const usage = SAMPLE_USAGE;
  const sample = true;
  const activeMode = state?.jevDecisionEnabled ? 'jev' : 'llm';
  const pick = (read: (usage: DecisionUsageSummary) => number) => ({
    ...(usage.jev ? { jev: read(usage.jev) } : {}),
    ...(usage.llm ? { llm: read(usage.llm) } : {}),
  });

  return (
    <>
      <PageHeader
        title="사용량"
        subtitle="요청 판단에 쓴 시간·토큰·비용을 Jev와 LLM으로 나눠 봅니다"
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
        {sample && (
          <div className="decision-usage-sample">
            <span className="connection-badge warning">예시</span>
            아직 실제 기록이 아니에요. 요청별 사용량 기록이 붙으면 이 자리에 실제 값이 나옵니다.
          </div>
        )}

        <section className="settings-section usage-donuts" aria-label="Jev와 LLM의 몫">
          <ShareDonut title="판단 비용" values={pick((u) => u.costUsd)} format={usd} />
          <ShareDonut title="판단 시간" values={pick((u) => u.totalMs)} format={duration} />
          <ShareDonut title="토큰" values={pick(totalTokens)} format={tokens} />
        </section>

        <section className="settings-section decision-usage">
          <h4>요청 한 건 기준</h4>
          <UsageCompareTable usage={usage} activeMode={activeMode} />
          <p className="muted decision-usage-note">
            두 방식을 번갈아 쓰면 서로 다른 요청을 판단한 값이라 그대로 비교하기 어려워요. 같은 요청끼리 비교하려면 설정 → 요청 판단에서 "함께 판단해서 비교"를 켜 주세요.
          </p>
        </section>
      </div>
    </>
  );
}
