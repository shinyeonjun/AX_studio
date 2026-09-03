import { AI_PROVIDER_UI_CATALOG } from '../../constants/ai-providers';
import { isBrandReady } from '../../lib/ai-settings/brand-readiness';
import type { AiProviderState, AiBrandConfigurationActionsInput } from './contracts';

export function createAiBrandConfigurationActions({
  brand,
  mode,
  model,
  apiKeyDraft,
  cliProviders,
  brandSecrets,
  verifiedCli,
  verifiedApi,
  isActive,
  canSave,
  onRefresh,
  refreshDetection,
  setApiKeyDraft,
  setApiKeyConfigured,
  setMessage,
  setSaving,
  setVerifiedApi,
}: AiBrandConfigurationActionsInput) {
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

  return { activateBrand, save };
}
