import { useMemo, useState } from 'react';
import { AI_PROVIDER_UI_CATALOG, brandFromProvider, modelsForBrand } from '../../../ui/constants/ai-providers';
import { isBrandReady } from '../lib/ai-settings/brand-readiness';
import type { useAiDetection } from './ai-settings/useAiDetection';
import type { AiBrand } from '../../../types/ai-provider';
import type { AppState } from '../../../types/app-state';
import { createAiBrandSettingsActions } from './ai-brand-settings/actions';
import { useAiBrandSettingsInitialization } from './ai-brand-settings/initialization';

type AiDetection = ReturnType<typeof useAiDetection>;

export function useAiBrandSettings(
  brand: AiBrand,
  state: AppState | null,
  onRefresh: () => Promise<void>,
  detection: AiDetection,
) {
  const { cliProviders, verifiedCli, setVerifiedCli, configFilePath, refreshDetection } = detection;
  const [initialized, setInitialized] = useState(false);
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingCli, setTestingCli] = useState(false);
  const [message, setMessageText] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);

  const setMessage = (text: string, isError = false) => {
    setMessageText(text);
    setMessageIsError(isError);
  };

  const activeBrand = brandFromProvider(state?.aiProvider?.provider, state?.aiProvider?.brand);
  const isActive = activeBrand === brand;

  useAiBrandSettingsInitialization({ brand, state, refreshDetection, setModel, setInitialized });

  const selectedCli = cliProviders.find((item) => item.id === AI_PROVIDER_UI_CATALOG[brand].cliProviderId);
  const models = useMemo(() => modelsForBrand(brand, selectedCli?.models), [brand, selectedCli?.models]);
  const cliVerified = Boolean(verifiedCli[brand]);
  const canSave = Boolean(model) && Boolean(selectedCli?.installed || selectedCli?.command || cliVerified);
  const status: 'active' | 'ready' | 'off' = isActive
    ? 'active'
    : isBrandReady(brand, cliProviders, verifiedCli) ? 'ready' : 'off';

  const actions = createAiBrandSettingsActions({
    brand,
    onRefresh,
    refreshDetection,
    model,
    cliProviders,
    verifiedCli,
    canSave,
    setSaving,
    setTestingCli,
    setMessage,
    setVerifiedCli,
  });

  return {
    initialized,
    model,
    models,
    configFilePath,
    saving,
    testingCli,
    cliVerified,
    message,
    messageIsError,
    canSave,
    isActive,
    status,
    selectedCli,
    ...actions,
    setModel,
  };
}
