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
  canSave,
  onRefresh,
  refreshDetection,
  setApiKeyDraft,
  setApiKeyConfigured,
  setMessage,
  setSaving,
  setVerifiedApi,
}: AiBrandConfigurationActionsInput) {
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

  return { save };
}
