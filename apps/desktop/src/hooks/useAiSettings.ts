import { useMemo, useState } from 'react';
import { AI_PROVIDER_UI_CATALOG, brandFromProvider, modelsForBrand } from '../constants/ai-providers';
import { isBrandReady, resolveBrandModel } from '../lib/ai-settings/brand-readiness';
import type { AiBrand, AiConnectionMode, AiSecretStatus, DetectedAiCli } from '../types/ai-provider';
import type { AiProviderState, AppState } from '../types/app-state';

export function useAiSettings(
  state: AppState | null,
  onRefresh: () => Promise<void>,
  onAiSaved?: () => void,
) {
  const [cliProviders, setCliProviders] = useState<DetectedAiCli[]>([]);
  const [brandSecrets, setBrandSecrets] = useState<Record<string, AiSecretStatus>>({});
  const [verifiedCli, setVerifiedCli] = useState<Partial<Record<AiBrand, boolean>>>({});
  const [verifiedApi, setVerifiedApi] = useState<Partial<Record<AiBrand, boolean>>>({});
  const [detecting, setDetecting] = useState(false);
  const [brand, setBrand] = useState<AiBrand | null>(null);
  const [mode, setMode] = useState<AiConnectionMode>('cli');
  const [model, setModel] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | undefined>();
  const [configFilePath, setConfigFilePath] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingCli, setTestingCli] = useState(false);
  const [message, setMessage] = useState('');
  const [hubMessage, setHubMessage] = useState('');

  const activeBrand = brandFromProvider(state?.aiProvider?.provider, state?.aiProvider?.brand);
  const activeMode = state?.aiProvider?.mode;

  const refreshDetection = async () => {
    const [detected, aiConfig] = await Promise.all([
      window.ax.detectAiCli(),
      window.ax.getAiConfig(),
    ]);
    setCliProviders(detected);
    setBrandSecrets(aiConfig.secrets);
    setConfigFilePath(aiConfig.path);
    return { detected, aiConfig };
  };

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
      const nextMode =
        nextBrand === 'grok'
          ? 'cli'
          : brandPrefs?.mode ?? (isActive && saved?.mode ? saved.mode : 'cli');
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
    if (target === 'grok') return 'cli';
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
    if (brand === 'grok') {
      const hasCli = Boolean(selectedCli?.binaryFound ?? selectedCli?.command ?? cliVerified);
      const hasApi = apiKeyConfigured || apiVerified || Boolean(apiKeyDraft.trim());
      return hasCli && hasApi;
    }
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
      setVerifiedCli((prev) => ({ ...prev, [brand]: true }));
      const version = result.version ? ` · ${result.version}` : '';
      setMessage(`agent CLI 확인됨: ${result.command}${version}`);
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
      const result = await window.ax.testAiApi(brand, draft || undefined);
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
      const saveMode = brand === 'grok' ? 'cli' : mode;
      if (draft) {
        await window.ax.saveAiBrandConfig(brand, { mode: saveMode, model, apiKey: draft });
        setApiKeyDraft('');
        setApiKeyConfigured(true);
        setVerifiedApi((prev) => ({ ...prev, [brand]: true }));
      } else {
        await window.ax.saveAiBrandConfig(brand, { mode: saveMode, model });
      }

      const ready = isBrandReady(brand, saveMode, cliProviders, brandSecrets, verifiedCli, verifiedApi);
      if (ready) {
        const config: AiProviderState = { brand, mode: saveMode, model };
        await window.ax.setAiProvider(config);
        setMessage('저장되었습니다. 이 AI가 사용 중입니다.');
        onAiSaved?.();
      } else if (brand === 'grok') {
        setMessage('설정이 저장되었습니다. agent CLI와 API 키를 모두 확인하세요.');
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
