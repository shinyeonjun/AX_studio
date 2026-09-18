import { useMemo } from 'react';
import { settingsScreenForBrand } from '../../../ui/constants/settings';
import { useAiHub } from '../hooks/useAiHub';
import type { useAiDetection } from '../hooks/ai-settings/useAiDetection';
import type { AiBrand } from '../../../types/ai-provider';
import type { SettingsScreen } from '../../../types/navigation';
import type { AppState } from '../../../types/app-state';
import { SettingsCategory } from './SettingsCategory';
import { ConnectionCard } from './ConnectionCard';
import { AiHubCards } from './ai/AiHubCards';
import { SettingsConnectorSections } from './settings-hub/connector-sections';

type AiDetection = ReturnType<typeof useAiDetection>;

interface SettingsHubProps {
  state: AppState | null;
  detecting: boolean;
  detection: AiDetection;
  onRefresh: () => Promise<void>;
  onOpenScreen: (screen: SettingsScreen) => void;
}

export function SettingsHub({ state, detecting, detection, onRefresh, onOpenScreen }: SettingsHubProps) {
  const hub = useAiHub(state, onRefresh, detection);

  const openBrand = useMemo(
    () => (brand: AiBrand) => onOpenScreen(settingsScreenForBrand(brand)),
    [onOpenScreen],
  );

  const jevConfigured = Boolean(state?.jevDecisionConfigured);
  const jevEnabled = Boolean(state?.jevDecisionEnabled);
  const jevBadge = jevEnabled && jevConfigured
    ? '사용 중'
    : jevConfigured
      ? '준비됨'
      : '미연결';

  return (
    <div className="settings-scroll">
      <SettingsCategory title="AI" description="인터뷰·분류·판단에 사용할 AI를 연결합니다.">
        <AiHubCards state={state} detecting={detecting} hub={hub} onOpenBrand={openBrand} />
      </SettingsCategory>

      <SettingsCategory
        title="Decision Plane"
        description="생성 모델과 분리된 저비용 판단 엔진을 연결합니다."
      >
        <div className="connection-hub">
          <ConnectionCard
            title="Jev"
            description={state?.jevDecisionModel
              ? `${state.jevDecisionModel} · 소스 선택, ambiguity 판정, 복구 분기`
              : '소스 선택, ambiguity 판정, 복구 분기'}
            emojiIcon="🧭"
            badge={jevBadge}
            badgeClass={jevConfigured ? 'connected' : ''}
            onClick={() => onOpenScreen('ai-jev')}
          />
        </div>
      </SettingsCategory>

      <SettingsConnectorSections state={state} onOpenScreen={onOpenScreen} />
    </div>
  );
}
