import { brandFromProvider } from '../../constants/ai-providers';
import { isBrandReady, resolveBrandModel } from './brand-readiness';
import type { useAiDetection } from '../../hooks/ai-settings/useAiDetection';
import type { AiBrand } from '../../types/ai-provider';
import type { AppState } from '../../types/app-state';

type AiDetection = ReturnType<typeof useAiDetection>;

export function getAiBrandHubStatus(
  brand: AiBrand,
  state: AppState | null,
  detection: AiDetection,
): 'active' | 'ready' | 'off' {
  const activeBrand = brandFromProvider(state?.aiProvider?.provider, state?.aiProvider?.brand);
  if (activeBrand === brand) return 'active';

  const mode = state?.aiBrandConfigs?.[brand]?.mode ?? 'cli';
  const model = resolveBrandModel(
    brand,
    mode,
    detection.cliProviders,
    state?.aiBrandConfigs?.[brand],
    activeBrand === brand ? state?.aiProvider?.model : undefined,
  );

  return isBrandReady(
    brand,
    mode,
    detection.cliProviders,
    detection.brandSecrets,
    detection.verifiedCli,
    detection.verifiedApi,
  ) && model
    ? 'ready'
    : 'off';
}
