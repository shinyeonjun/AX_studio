import { useState } from 'react';
import type { AppState } from '../../../../types/app-state';
import { confirmDisconnectConnector } from '../../../../lib/confirm-delete';

export interface GmailConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

type GmailConnectionControllerProps = Pick<GmailConnectionFormProps, 'onConnect' | 'onDisconnect'>;

export function useGmailConnectionForm({ onConnect, onDisconnect }: GmailConnectionControllerProps) {
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

  return { busy, message, handleConnect, handleDisconnect };
}
