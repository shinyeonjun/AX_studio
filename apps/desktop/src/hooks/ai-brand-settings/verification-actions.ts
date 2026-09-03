import { AI_PROVIDER_UI_CATALOG } from '../../constants/ai-providers';
import type { AiBrandVerificationActionsInput } from './contracts';

export function createAiBrandVerificationActions({
  brand,
  mode,
  apiKeyDraft,
  onRefresh,
  refreshDetection,
  setApiKeyDraft,
  setApiKeyConfigured,
  setApiKeyMasked,
  setMessage,
  setTesting,
  setTestingCli,
  setVerifiedApi,
  setVerifiedCli,
}: AiBrandVerificationActionsInput) {
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

  return { testCli, testApiKey };
}
