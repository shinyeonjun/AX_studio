import { AI_PROVIDER_UI_CATALOG } from '../../../../ui/constants/ai-providers';
import type { AiBrandVerificationActionsInput } from './contracts';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';

export function createAiBrandVerificationActions({
  brand,
  refreshDetection,
  setMessage,
  setTestingCli,
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
      setMessage(ipcErrorMessage(error, 'CLI 확인에 실패했습니다.'), true);
    } finally {
      setTestingCli(false);
    }
  };

  return { testCli };
}
