import { useState } from 'react';
import { SettingRow, SettingSwitch } from '../SettingRow';
import { SAMPLE_USAGE, type UsagePeriod } from './decision-mode/contracts';
import { DecisionUsageCompare } from './decision-mode/DecisionUsageCompare';
import { JevDecisionSwitch } from './decision-mode/JevDecisionSwitch';

interface JevDecisionPlaneFormProps {
  onRefresh: () => Promise<void>;
}

/** Request decision: Jev on or off, deciding side by side for comparison, and the usage of each. */
export function JevDecisionPlaneForm({ onRefresh }: JevDecisionPlaneFormProps) {
  const [jevEnabled, setJevEnabled] = useState(false);
  // The side-by-side switch and the usage table are not wired to the app yet.
  const [shadowCompare, setShadowCompare] = useState(false);
  const [usagePeriod, setUsagePeriod] = useState<UsagePeriod>('week');

  return (
    <div className="settings-scroll">
      <div className="settings-section decision-settings">
        <JevDecisionSwitch onRefresh={onRefresh} onEnabledChange={setJevEnabled} />
        <SettingRow
          title="함께 판단해서 비교"
          description="실행은 지금 방식만 하고, 다른 방식도 같은 요청에 판단만 해서 기록합니다. 판단 비용이 두 배로 들어요."
          control={<SettingSwitch label="함께 판단해서 비교" checked={shadowCompare} onChange={setShadowCompare} />}
        >
          <span className="connection-badge warning decision-preview-badge">미리보기 · 저장 안 됨</span>
        </SettingRow>
      </div>

      <DecisionUsageCompare
        period={usagePeriod}
        usage={SAMPLE_USAGE}
        sample
        activeMode={jevEnabled ? 'jev' : 'llm'}
        onPeriodChange={setUsagePeriod}
      />
    </div>
  );
}
