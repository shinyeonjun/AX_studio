import { useEffect, useMemo, useState } from 'react';
import { AI_PROVIDER_UI_CATALOG, brandFromProvider, modelsForBrand } from '../constants/ai-providers';
import { isBrandReady, resolveBrandModel } from '../lib/ai-settings/brand-readiness';
import type { useAiDetection } from './ai-settings/useAiDetection';
import type { AiBrand, AiConnectionMode, AiProviderState } from '../types/ai-provider';
import type { AppState } from '../types/app-state';

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
        const nextMode = brandPrefs?.mode ?? (active && saved?.mode ? saved.mode : 'cli');
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
    return apiKeyConfigured || apiVerified || Boolean(apiKeyDraft.trim());
  }, [mode, model, selectedCli, cliVerified, apiKeyConfigured, apiVerified, apiKeyDraft]);

  const status: 'active' | 'ready' | 'off' = isActive
    ? 'active'
    : isBrandReady(brand, mode, cliProviders, brandSecrets, verifiedCli, verifiedApi)
      ? 'ready'
      : 'off';

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

  const activateBrand = async () => {
    if (isActive || !canSave) return;
    setSaving(true);
    setMessage('');
    try {
      await window.ax.saveAiBrandConfig(brand, { mode, model });
      await window.ax.setAiProvider({ brand, mode, model });
      await onRefresh();
      await refreshDetection();
      setMessage(`${AI_PROVIDER_UI_CATALOG[brand].title}를 사용 중으로 전환했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI 전환에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const testCli = async () => {
    setTestingCli(true);
    setMessage('');
    try {
      const result = await window.ax.testAiCli(brand);
      const meta = AI_PROVIDER_UI_CATALOG[brand];
      setVerifiedCli((prev) => ({ ...prev, [brand]: true }));
      const version = result.version ? ` · ${result.version}` : '';
      setMessage(`${meta.cliLabel} 확인됨: ${result.command}${version}`);
      await refreshDetection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'CLI 확인에 실패했습니다.');
    } finally {
      setTestingCli(false);
    }
  };

  const testApiKey = async () => {
    setTesting(true);
    setMessage('');
    try {
      const draft = apiKeyDraft.trim();
      const result = await window.ax.testAiApi(brand, draft || undefined, mode);
      setVerifiedApi((prev) => ({ ...prev, [brand]: true }));
      if (draft) {
        setApiKeyDraft('');
        setApiKeyConfigured(true);
        setApiKeyMasked(result.masked);
      }
      setMessage(`API 연결됨: ${result.label}`);
      await refreshDetection();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'API 연결 테스트에 실패했습니다.');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setMessage('');
    try {
      const draft = apiKeyDraft.trim();
      if (draft) {
        await window.ax.saveAiBrandConfig(brand, { mode, model, apiKey: draft });
        setApiKeyDraft('');
        setApiKeyConfigured(true);
        setVerifiedApi((prev) => ({ ...prev, [brand]: true }));
      } else {
        await window.ax.saveAiBrandConfig(brand, { mode, model });
      }

      const ready = isBrandReady(brand, mode, cliProviders, brandSecrets, verifiedCli, verifiedApi);
      if (ready) {
        const config: AiProviderState = { brand, mode, model };
        await window.ax.setAiProvider(config);
        setMessage('저장되었습니다. 이 AI가 사용 중입니다.');
      } else {
        setMessage('설정이 ai.toml에 저장되었습니다.');
      }
      await onRefresh();
      await refreshDetection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

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
    selectMode,
    setModel,
    setApiKeyDraft,
    activateBrand,
    testCli,
    testApiKey,
    save,
  };
}
