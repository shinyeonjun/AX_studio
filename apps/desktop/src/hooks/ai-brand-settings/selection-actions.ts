import { AI_PROVIDER_UI_CATALOG } from '../../constants/ai-providers';
import { resolveBrandModel } from '../../lib/ai-settings/brand-readiness';
import type { AiConnectionMode } from '../../types/ai-provider';
import type { AiBrandSelectionActionsInput } from './contracts';

export function createAiBrandSelectionActions({
  brand,
  state,
  cliProviders,
  isActive,
  setMode,
  setModel,
}: AiBrandSelectionActionsInput) {
  const selectMode = (nextMode: AiConnectionMode) => {
    const brandPrefs = state?.aiBrandConfigs?.[brand];
    setMode(nextMode);
    setModel(
      resolveBrandModel(
        brand,
        nextMode,
        cliProviders,
        brandPrefs,
        isActive ? state?.aiProvider?.model : undefined,
      ),
    );
  };

  return { selectMode };
}
