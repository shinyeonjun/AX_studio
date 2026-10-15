import { useState } from 'react';
import { SettingRow, SettingSwitch } from '../SettingRow';
import { JevDecisionSwitch } from './decision-mode/JevDecisionSwitch';

interface JevDecisionPlaneFormProps {
  onRefresh: () => Promise<void>;
}

/** Request decision: Jev on or off (with its key), and deciding side by side for comparison. */
export function JevDecisionPlaneForm({ onRefresh }: JevDecisionPlaneFormProps) {
  // The side-by-side switch is not wired to the app yet.
  const [shadowCompare, setShadowCompare] = useState(false);

  return (
    <div className="settings-scroll">
      <div className="settings-section decision-settings">
        <JevDecisionSwitch onRefresh={onRefresh} />
        <SettingRow
          title="함께 판단해서 비교"
          description="실행은 지금 방식만 하고, 다른 방식도 같은 요청에 판단만 해서 기록합니다. 판단 비용이 두 배로 들어요. 비교는 왼쪽 메뉴의 사용량에서 봅니다."
          control={<SettingSwitch label="함께 판단해서 비교" checked={shadowCompare} onChange={setShadowCompare} />}
        >
          <span className="connection-badge warning decision-preview-badge">미리보기 · 저장 안 됨</span>
        </SettingRow>
      </div>
    </div>
  );
}
