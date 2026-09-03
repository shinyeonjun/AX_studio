import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { AI_PROVIDER_UI_CATALOG, brandFromProvider } from '../../constants/ai-providers';
import { resolveBrandModel } from '../../lib/ai-settings/brand-readiness';
import type { useAiDetection } from '../ai-settings/useAiDetection';
import type { AiBrand, AiConnectionMode } from '../../types/ai-provider';
import type { AppState } from '../../types/app-state';

type AiDetection = ReturnType<typeof useAiDetection>;

interface AiBrandSettingsInitializationInput {
  brand: AiBrand;
  state: AppState | null;
  cliProviders: AiDetection['cliProviders'];
  refreshDetection: AiDetection['refreshDetection'];
  setApiKeyConfigured: Dispatch<SetStateAction<boolean>>;
  setApiKeyMasked: Dispatch<SetStateAction<string | undefined>>;
  setMode: Dispatch<SetStateAction<AiConnectionMode>>;
  setModel: Dispatch<SetStateAction<string>>;
  setInitialized: Dispatch<SetStateAction<boolean>>;
}

export function useAiBrandSettingsInitialization({
  brand,
  state,
  cliProviders,
  refreshDetection,
  setApiKeyConfigured,
  setApiKeyMasked,
  setMode,
  setModel,
  setInitialized,
}: AiBrandSettingsInitializationInput) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { aiConfig } = await refreshDetection();
        if (cancelled) return;

        const secret = aiConfig.secrets[brand];
        setApiKeyConfigured(secret?.configured ?? false);
        setApiKeyMasked(secret?.masked);

        const saved = state?.aiProvider;
        const savedBrand = brandFromProvider(saved?.provider, saved?.brand);
        const brandPrefs = aiConfig.providers[brand] ?? state?.aiBrandConfigs?.[brand];
        const active = savedBrand === brand;
        const nextMode = brandPrefs?.mode ?? (active && saved?.mode ? saved.mode : brand === 'ollama' ? 'api' : 'cli');
        const nextModel = resolveBrandModel(
          brand,
          nextMode,
          cliProviders,
          brandPrefs,
          active ? saved?.model : undefined,
        );
        setMode(nextMode);
        setModel(nextModel);
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
