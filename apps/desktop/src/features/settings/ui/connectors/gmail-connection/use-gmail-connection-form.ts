import { useState } from 'react';
import type { AppState } from '../../../../../types/app-state';
import { confirmDisconnectConnector } from '../../../../../ui/lib/confirm-delete';
import { ipcErrorMessage } from '../../../../../ui/lib/ipc-error';

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
  const [messageIsError, setMessageIsError] = useState(false);
  const showMessage = (text: string, isError = false) => {
    setMessage(text);
    setMessageIsError(isError);
  };

  const handleConnect = async () => {
    setBusy(true);
    showMessage('');
    try {
      await onConnect();
      showMessage('Gmail 연결이 완료되었습니다.');
    } catch (error) {
      showMessage(ipcErrorMessage(error, 'Gmail 연결에 실패했습니다.'), true);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!await confirmDisconnectConnector('Gmail')) return;
    setBusy(true);
    showMessage('');
    try {
      await onDisconnect();
      showMessage('Gmail 연결이 해제되었습니다.');
    } catch (error) {
      showMessage(ipcErrorMessage(error, 'Gmail 연결 해제에 실패했습니다.'), true);
    } finally {
      setBusy(false);
    }
  };

  return { busy, message, messageIsError, handleConnect, handleDisconnect };
}
