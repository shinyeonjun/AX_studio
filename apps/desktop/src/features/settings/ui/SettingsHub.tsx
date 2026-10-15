import { useMemo } from 'react';
import { settingsScreenForBrand } from '../../../ui/constants/settings';
import { useAiHub } from '../hooks/useAiHub';
import type { useAiDetection } from '../hooks/ai-settings/useAiDetection';
import type { AiBrand } from '../../../types/ai-provider';
import type { SettingsScreen } from '../../../types/navigation';
import type { AppState } from '../../../types/app-state';
import { SettingsCategory } from './SettingsCategory';
import { AiHubCards } from './ai/AiHubCards';
import { JevDecisionSwitch } from './ai/decision-mode/JevDecisionSwitch';
import { SettingsConnectorSections } from './settings-hub/connector-sections';
import { StartupSection } from './StartupSection';

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

  return (
    <div className="settings-scroll">
      <SettingsCategory title="AI" description="대화와 문서 작성에 쓸 AI를 연결합니다.">
        <AiHubCards state={state} detecting={detecting} hub={hub} onOpenBrand={openBrand} />
      </SettingsCategory>

      <SettingsCategory
        title="요청 판단"
        description="요청을 보고 무엇을 할지 정하는 방식을 고릅니다."
      >
        <JevDecisionSwitch onRefresh={onRefresh} />
        <button type="button" className="decision-usage-link" onClick={() => onOpenScreen('ai-jev')}>
          판단 사용량 비교 보기 →
        </button>
      </SettingsCategory>

      <SettingsConnectorSections state={state} onOpenScreen={onOpenScreen} />

      <StartupSection />
    </div>
  );
}
