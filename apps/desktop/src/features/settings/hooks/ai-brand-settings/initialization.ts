import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { brandFromProvider } from '../../../../ui/constants/ai-providers';
import { resolveBrandModel } from '../../lib/ai-settings/brand-readiness';
import type { useAiDetection } from '../ai-settings/useAiDetection';
import type { AiBrand } from '../../../../types/ai-provider';
import type { AppState } from '../../../../types/app-state';

type AiDetection = ReturnType<typeof useAiDetection>;

interface AiBrandSettingsInitializationInput {
  brand: AiBrand;
  state: AppState | null;
  refreshDetection: AiDetection['refreshDetection'];
  setModel: Dispatch<SetStateAction<string>>;
  setInitialized: Dispatch<SetStateAction<boolean>>;
}

export function useAiBrandSettingsInitialization({
  brand,
  state,
  refreshDetection,
  setModel,
  setInitialized,
}: AiBrandSettingsInitializationInput) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { detected, aiConfig } = await refreshDetection();
        if (cancelled) return;
        const saved = state?.aiProvider;
        const active = brandFromProvider(saved?.provider, saved?.brand) === brand;
        const brandPrefs = aiConfig.providers[brand] ?? state?.aiBrandConfigs?.[brand];
        setModel(resolveBrandModel(brand, detected, brandPrefs, active ? saved?.model : undefined));
        setInitialized(true);
      } catch {
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per-brand init
  }, [brand]);
}
