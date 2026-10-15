import { brandFromProvider } from '../../../../ui/constants/ai-providers';
import { isBrandReady, resolveBrandModel } from './brand-readiness';
import type { useAiDetection } from '../../hooks/ai-settings/useAiDetection';
import type { AiBrand } from '../../../../types/ai-provider';
import type { AppState } from '../../../../types/app-state';

type AiDetection = ReturnType<typeof useAiDetection>;

export function getAiBrandHubStatus(
  brand: AiBrand,
  state: AppState | null,
  detection: AiDetection,
): 'active' | 'ready' | 'off' {
  const activeBrand = brandFromProvider(state?.aiProvider?.provider, state?.aiProvider?.brand);
  if (activeBrand === brand) return 'active';
  const model = resolveBrandModel(brand, detection.cliProviders, state?.aiBrandConfigs?.[brand]);
  return isBrandReady(brand, detection.cliProviders, detection.verifiedCli) && model ? 'ready' : 'off';
}
