import { useState } from 'react';
import { AI_PROVIDER_UI_CATALOG, brandFromProvider } from '../constants/ai-providers';
import { getAiBrandHubStatus } from '../lib/ai-settings/hub-status';
import { isBrandReady, resolveBrandModel } from '../lib/ai-settings/brand-readiness';
import type { useAiDetection } from './ai-settings/useAiDetection';
import type { AiBrand, AiConnectionMode } from '../types/ai-provider';
import type { AppState } from '../types/app-state';

type AiDetection = ReturnType<typeof useAiDetection>;

export function useAiHub(
  state: AppState | null,
  onRefresh: () => Promise<void>,
  detection: AiDetection,
) {
  const { cliProviders, brandSecrets, verifiedCli, verifiedApi, refreshDetection } = detection;
  const [modeSaving, setModeSaving] = useState(false);
  const [hubMessage, setHubMessage] = useState('');

  const activeBrand = brandFromProvider(state?.aiProvider?.provider, state?.aiProvider?.brand);
  const activeMode = state?.aiProvider?.mode;

  const brandMode = (target: AiBrand): AiConnectionMode => {
    if (activeBrand === target && activeMode) return activeMode;
    return state?.aiBrandConfigs?.[target]?.mode ?? 'cli';
  };

  const brandStatus = (target: AiBrand): 'active' | 'ready' | 'off' =>
    getAiBrandHubStatus(target, state, detection);

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
    setModeSaving(true);
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
      setModeSaving(false);
    }
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

    setModeSaving(true);
    setHubMessage('');
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
    } finally {
      setModeSaving(false);
    }
  };

  return {
    activeBrand,
    brandStatus,
    brandMode,
    modeSaving,
    hubMessage,
    selectBrand,
    setBrandMode,
  };
}

export type AiHubController = ReturnType<typeof useAiHub>;
