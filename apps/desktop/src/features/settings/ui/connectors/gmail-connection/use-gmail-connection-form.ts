import { useState } from 'react';
import type { AppState } from '../../../../../types/app-state';
import { confirmDisconnectConnector } from '../../../../../ui/lib/confirm-delete';

export interface GmailConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRefresh?: () => Promise<void>;
}

type GmailConnectionControllerProps = Pick<GmailConnectionFormProps, 'onConnect' | 'onDisconnect' | 'onRefresh'>;

export function useGmailConnectionForm({ onConnect, onDisconnect, onRefresh }: GmailConnectionControllerProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect();
      setMessage('Gmail 연결이 완료되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gmail 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirmDisconnectConnector('Gmail')) return;
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('Gmail 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gmail 연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const configureClient = async (clear = false) => {
    setBusy(true);
    setMessage('');
    try {
      const result = clear ? await window.ax.clearGmailOAuthClient() : await window.ax.importGmailOAuthClient();
      if (result.ok) {
        await onRefresh?.();
        setMessage(clear ? '가져온 OAuth 설정을 제거했습니다.' : 'OAuth 설정을 저장했습니다. 이제 Gmail을 연결해 주세요.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'OAuth 설정을 저장하지 못했습니다.');
    } finally { setBusy(false); }
  };

  return { busy, message, handleConnect, handleDisconnect, configureClient };
}
