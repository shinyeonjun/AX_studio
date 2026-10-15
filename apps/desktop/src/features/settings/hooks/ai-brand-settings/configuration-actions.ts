import { isBrandReady } from '../../lib/ai-settings/brand-readiness';
import type { AiProviderState, AiBrandConfigurationActionsInput } from './contracts';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';

export function createAiBrandConfigurationActions({
  brand,
  model,
  cliProviders,
  verifiedCli,
  canSave,
  onRefresh,
  refreshDetection,
  setMessage,
  setSaving,
}: AiBrandConfigurationActionsInput) {
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setMessage('');
    try {
      await window.ax.saveAiBrandConfig(brand, { model });
      if (isBrandReady(brand, cliProviders, verifiedCli)) {
        const config: AiProviderState = { brand, model };
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
