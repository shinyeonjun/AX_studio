import { useMemo, useState } from 'react';
import { AI_PROVIDER_UI_CATALOG, brandFromProvider, modelsForBrand } from '../constants/ai-providers';
import { isBrandReady } from '../lib/ai-settings/brand-readiness';
import type { useAiDetection } from './ai-settings/useAiDetection';
import type { AiBrand, AiConnectionMode } from '../types/ai-provider';
import type { AppState } from '../types/app-state';
import { createAiBrandSettingsActions } from './ai-brand-settings/actions';
import { useAiBrandSettingsInitialization } from './ai-brand-settings/initialization';

type AiDetection = ReturnType<typeof useAiDetection>;

export function useAiBrandSettings(
  brand: AiBrand,
  state: AppState | null,
  onRefresh: () => Promise<void>,
  detection: AiDetection,
) {
  const {
    cliProviders,
    brandSecrets,
    verifiedCli,
    setVerifiedCli,
    verifiedApi,
    setVerifiedApi,
    configFilePath,
    refreshDetection,
  } = detection;

  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<AiConnectionMode>('cli');
  const [model, setModel] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingCli, setTestingCli] = useState(false);
  const [message, setMessage] = useState('');

  const activeBrand = brandFromProvider(state?.aiProvider?.provider, state?.aiProvider?.brand);
  const isActive = activeBrand === brand;

  useAiBrandSettingsInitialization({
    brand,
    state,
    cliProviders,
    refreshDetection,
    setApiKeyConfigured,
    setApiKeyMasked,
    setMode,
    setModel,
    setInitialized,
  });

  const selectedCli = cliProviders.find((item) => item.id === AI_PROVIDER_UI_CATALOG[brand].cliProviderId);
  const models = useMemo(
    () => modelsForBrand(brand, mode, selectedCli?.models),
    [brand, mode, selectedCli?.models],
  );
  const cliVerified = Boolean(verifiedCli[brand]);
  const apiVerified = Boolean(verifiedApi[brand]);

  const canSave = useMemo(() => {
    if (!model) return false;
    if (mode === 'cli') {
      return Boolean(selectedCli?.installed || selectedCli?.command || cliVerified);
    }
    return brand === 'ollama' ? apiVerified : apiKeyConfigured || apiVerified || Boolean(apiKeyDraft.trim());
  }, [mode, model, selectedCli, cliVerified, apiKeyConfigured, apiVerified, apiKeyDraft]);

  const status: 'active' | 'ready' | 'off' = isActive
    ? 'active'
    : isBrandReady(brand, mode, cliProviders, brandSecrets, verifiedCli, verifiedApi)
      ? 'ready'
      : 'off';

  const actions = createAiBrandSettingsActions({
    brand,
    state,
    onRefresh,
    refreshDetection,
    mode,
    model,
    apiKeyDraft,
    cliProviders,
    brandSecrets,
    verifiedCli,
    verifiedApi,
    isActive,
    canSave,
    setMode,
    setModel,
    setApiKeyDraft,
    setApiKeyConfigured,
    setApiKeyMasked,
    setSaving,
    setTesting,
    setTestingCli,
    setMessage,
    setVerifiedCli,
    setVerifiedApi,
  });

  return {
    initialized,
    mode,
    model,
    models,
    apiKeyDraft,
    apiKeyConfigured,
    apiKeyMasked,
    configFilePath,
    saving,
    testing,
    testingCli,
    cliVerified,
    apiVerified,
    message,
    canSave,
    isActive,
    status,
    selectedCli,
    ...actions,
    setModel,
    setApiKeyDraft,
  };
}
