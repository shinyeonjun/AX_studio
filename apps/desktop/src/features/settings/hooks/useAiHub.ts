import { useState } from 'react';
import { AI_PROVIDER_UI_CATALOG, brandFromProvider } from '../../../ui/constants/ai-providers';
import { getAiBrandHubStatus } from '../lib/ai-settings/hub-status';
import { isBrandReady, resolveBrandModel } from '../lib/ai-settings/brand-readiness';
import type { useAiDetection } from './ai-settings/useAiDetection';
import type { AiBrand } from '../../../types/ai-provider';
import type { AppState } from '../../../types/app-state';
import { ipcErrorMessage } from '../../../ui/lib/ipc-error';

type AiDetection = ReturnType<typeof useAiDetection>;

export function useAiHub(
  state: AppState | null,
  onRefresh: () => Promise<void>,
  detection: AiDetection,
) {
  const { cliProviders, verifiedCli, refreshDetection } = detection;
  const [switching, setSwitching] = useState(false);
  const [hubMessage, setHubMessage] = useState('');

  const activeBrand = brandFromProvider(state?.aiProvider?.provider, state?.aiProvider?.brand);

  const brandStatus = (target: AiBrand): 'active' | 'ready' | 'off' =>
    getAiBrandHubStatus(target, state, detection);

  const selectBrand = async (target: AiBrand) => {
    if (activeBrand === target) return;
    const model = resolveBrandModel(target, cliProviders, state?.aiBrandConfigs?.[target]);
    if (!model || !isBrandReady(target, cliProviders, verifiedCli)) {
      setHubMessage(`${AI_PROVIDER_UI_CATALOG[target].title} 연결이 필요합니다. 설정에서 완료하세요.`);
      return;
    }
    setSwitching(true);
    setHubMessage('');
    try {
      await window.ax.saveAiBrandConfig(target, { model });
      await window.ax.setAiProvider({ brand: target, model });
      await onRefresh();
      await refreshDetection();
      setHubMessage(`${AI_PROVIDER_UI_CATALOG[target].title}로 전환되었습니다.`);
    } catch (error) {
      setHubMessage(ipcErrorMessage(error, 'AI 전환에 실패했습니다.'));
    } finally {
      setSwitching(false);
    }
  };

  return { activeBrand, brandStatus, switching, hubMessage, selectBrand };
}

export type AiHubController = ReturnType<typeof useAiHub>;
