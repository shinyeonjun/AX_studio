import { isBrandReady } from '../../lib/ai-settings/brand-readiness';
import type { AiProviderState, AiBrandConfigurationActionsInput } from './contracts';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';

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
      // A new key is checked before it is kept, as the test button does; a wrong key stops here.
      const keyChecked = Boolean(draft) && mode === 'api';
      if (keyChecked) await window.ax.testAiApi(brand, draft, mode);
      await window.ax.saveAiBrandConfig(brand, { mode, model, ...(draft && !keyChecked ? { apiKey: draft } : {}) });
      if (draft) {
        setApiKeyDraft('');
        setApiKeyConfigured(true);
        if (keyChecked) setVerifiedApi((prev) => ({ ...prev, [brand]: true }));
      }

      // The state above updates after this turn, so a key checked just now counts here directly.
      const ready = keyChecked || isBrandReady(brand, mode, cliProviders, brandSecrets, verifiedCli, verifiedApi);
      if (ready) {
        const config: AiProviderState = { brand, mode, model };
        await window.ax.setAiProvider(config);
        setMessage('저장되었습니다. 이 AI가 사용 중입니다.');
      } else {
        setMessage('설정을 저장했어요.');
      }
      await onRefresh();
      await refreshDetection();
    } catch (error) {
      setMessage(ipcErrorMessage(error, '저장에 실패했습니다.'), true);
    } finally {
      setSaving(false);
    }
  };

  return { save };
}
