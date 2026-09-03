import { useMemo } from 'react';
import { settingsScreenForBrand } from '../../constants/settings';
import { useAiHub } from '../../hooks/useAiHub';
import type { useAiDetection } from '../../hooks/ai-settings/useAiDetection';
import type { AiBrand } from '../../types/ai-provider';
import type { SettingsScreen } from '../../types/navigation';
import type { AppState } from '../../types/app-state';
import { SettingsCategory } from './SettingsCategory';
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

  return (
    <div className="settings-scroll">
      <SettingsCategory title="AI" description="인터뷰·분류·판단에 사용할 AI를 연결합니다.">
        <AiHubCards state={state} detecting={detecting} hub={hub} onOpenBrand={openBrand} />
      </SettingsCategory>

      <SettingsConnectorSections state={state} onOpenScreen={onOpenScreen} />
    </div>
  );
}
