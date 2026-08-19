import { useMemo, useState } from 'react';
import { AI_PROVIDER_UI_CATALOG, brandFromProvider, modelsForBrand } from '../constants/ai-providers';
import { isBrandReady, resolveBrandModel } from '../lib/ai-settings/brand-readiness';
import { useAiDetection } from './ai-settings/useAiDetection';
import type { AiBrand, AiConnectionMode } from '../types/ai-provider';
import type { AiProviderState, AppState } from '../types/app-state';

export function useAiSettings(
  state: AppState | null,
  onRefresh: () => Promise<void>,
  onAiSaved?: () => void,
) {
  const detection = useAiDetection();
  const {
    cliProviders,
    brandSecrets,
    verifiedCli,
    setVerifiedCli,
    verifiedApi,
    setVerifiedApi,
    detecting,
    setDetecting,
    configFilePath,
    refreshDetection,
  } = detection;

  const [brand, setBrand] = useState<AiBrand | null>(null);
  const [mode, setMode] = useState<AiConnectionMode>('cli');
  const [model, setModel] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingCli, setTestingCli] = useState(false);
  const [message, setMessage] = useState('');
  const [hubMessage, setHubMessage] = useState('');

  const activeBrand = brandFromProvider(state?.aiProvider?.provider, state?.aiProvider?.brand);
  const activeMode = state?.aiProvider?.mode;

  const openAiHub = async () => {
    setDetecting(true);
    try {
      await refreshDetection();
    } finally {
      setDetecting(false);
    }
  };

  const openBrand = async (nextBrand: AiBrand) => {
    setBrand(nextBrand);
    setMessage('');
    setApiKeyDraft('');
    setDetecting(true);
    try {
      const { detected, aiConfig } = await refreshDetection();
      const secret = aiConfig.secrets[nextBrand];
      setApiKeyConfigured(secret?.configured ?? false);
      setApiKeyMasked(secret?.masked);

      const saved = state?.aiProvider;
      const savedBrand = brandFromProvider(saved?.provider, saved?.brand);
      const brandPrefs = aiConfig.providers[nextBrand] ?? state?.aiBrandConfigs?.[nextBrand];
      const isActive = savedBrand === nextBrand;
      const nextMode = brandPrefs?.mode ?? (isActive && saved?.mode ? saved.mode : 'cli');
      const nextModel = resolveBrandModel(
        nextBrand,
        nextMode,
        detected,
        brandPrefs,
        isActive ? saved?.model : undefined,
      );
      setMode(nextMode);
      setModel(nextModel);
    } finally {
      setDetecting(false);
    }
  };

  const selectMode = (nextMode: AiConnectionMode) => {
    if (!brand) return;
    const brandPrefs = state?.aiBrandConfigs?.[brand];
    setMode(nextMode);
    setModel(
      resolveBrandModel(
        brand,
        nextMode,
        cliProviders,
        brandPrefs,
        activeBrand === brand ? state?.aiProvider?.model : undefined,
      ),
    );
  };

  const brandMode = (target: AiBrand): AiConnectionMode => {
    if (activeBrand === target && activeMode) return activeMode;
    return state?.aiBrandConfigs?.[target]?.mode ?? 'cli';
  };

  const setBrandMode = async (target: AiBrand, nextMode: AiConnectionMode) => {
    const prefs = state?.aiBrandConfigs?.[target];
    const nextModel = resolveBrandModel(
      target,
      nextMode,
      cliProviders,
      prefs,
      activeBrand === target ? state?.aiProvider?.model : undefined,
    );

    setSaving(true);
    setHubMessage('');
    setMessage('');
    try {
      await window.ax.saveAiBrandConfig(target, { mode: nextMode, model: nextModel });
      if (
        activeBrand === target &&
        isBrandReady(target, nextMode, cliProviders, brandSecrets, verifiedCli, verifiedApi) &&
        nextModel
      ) {
        await window.ax.setAiProvider({ brand: target, mode: nextMode, model: nextModel });
      }
      await onRefresh();
      await refreshDetection();
    } catch (error) {
      const text = error instanceof Error ? error.message : '연결 방식 저장에 실패했습니다.';
      setHubMessage(text);
      setMessage(text);
    } finally {
      setSaving(false);
    }
  };

  const canSelectBrand = (target: AiBrand): boolean => {
    const mode = brandMode(target);
    const model = resolveBrandModel(
      target,
      mode,
      cliProviders,
      state?.aiBrandConfigs?.[target],
      activeBrand === target ? state?.aiProvider?.model : undefined,
    );
    return Boolean(model) && isBrandReady(target, mode, cliProviders, brandSecrets, verifiedCli, verifiedApi);
  };

  const selectBrand = async (target: AiBrand) => {
    if (activeBrand === target) return;
    if (!canSelectBrand(target)) {
      setHubMessage(`${AI_PROVIDER_UI_CATALOG[target].title} 연결이 필요합니다. 설정에서 완료하세요.`);
      return;
    }
    const mode = brandMode(target);
    const model = resolveBrandModel(
      target,
      mode,
      cliProviders,
      state?.aiBrandConfigs?.[target],
      activeBrand === target ? state?.aiProvider?.model : undefined,
    );
    setSaving(true);
    setHubMessage('');
    try {
      await window.ax.saveAiBrandConfig(target, { mode, model });
      await window.ax.setAiProvider({ brand: target, mode, model });
      await onRefresh();
      await refreshDetection();
      setHubMessage(`${AI_PROVIDER_UI_CATALOG[target].title}로 전환되었습니다.`);
    } catch (error) {
      setHubMessage(error instanceof Error ? error.message : 'AI 전환에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const brandStatus = (target: AiBrand): 'active' | 'ready' | 'off' => {
    if (activeBrand === target) return 'active';
    const mode = brandMode(target);
    return isBrandReady(target, mode, cliProviders, brandSecrets, verifiedCli, verifiedApi) ? 'ready' : 'off';
  };

  const selectedCli = brand
    ? cliProviders.find((item) => item.id === AI_PROVIDER_UI_CATALOG[brand].cliProviderId)
    : undefined;

  const models = useMemo(() => {
    if (!brand) return [];
    const cli = selectedCli?.models;
    return modelsForBrand(brand, mode, cli);
  }, [brand, mode, selectedCli]);

  const cliVerified = brand ? Boolean(verifiedCli[brand]) : false;
  const apiVerified = brand ? Boolean(verifiedApi[brand]) : false;

  const canSave = useMemo(() => {
    if (!brand || !model) return false;
    if (mode === 'cli') {
      return Boolean(selectedCli?.installed || selectedCli?.command || cliVerified);
    }
    return apiKeyConfigured || apiVerified || Boolean(apiKeyDraft.trim());
  }, [brand, mode, model, selectedCli, cliVerified, apiKeyConfigured, apiVerified, apiKeyDraft]);

  const saveApiKey = async () => {
    if (!brand) return;
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) return;
    setSaving(true);
    setMessage('');
    try {
      await window.ax.saveAiBrandConfig(brand, { mode, model, apiKey: trimmed });
      setApiKeyDraft('');
      setApiKeyConfigured(true);
      setVerifiedApi((prev) => ({ ...prev, [brand]: true }));
      setApiKeyMasked(`${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`);
      setMessage('API 키가 ai.toml에 저장되었습니다.');
      await refreshDetection();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const testCli = async () => {
    if (!brand) return;
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
    if (!brand) return;
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
    if (!brand || !canSave) return;
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
        onAiSaved?.();
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
    cliProviders,
    detecting,
    brand,
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
    activeBrand,
    activeMode,
    hubMessage,
    canSelectBrand,
    selectBrand,
    brandStatus,
    brandMode,
    setBrandMode,
    setModel,
    setApiKeyDraft,
    openAiHub,
    openBrand,
    selectMode,
    saveApiKey,
    testCli,
    testApiKey,
    save,
  };
}

export type AiSettingsController = ReturnType<typeof useAiSettings>;
