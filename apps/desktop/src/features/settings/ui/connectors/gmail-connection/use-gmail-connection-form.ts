import { useRef, useState } from 'react';
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
  // Google sign-in happens in the browser; until it returns, connecting again starts over.
  const [signingIn, setSigningIn] = useState(false);
  const attemptRef = useRef(0);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const showMessage = (text: string, isError = false) => {
    setMessage(text);
    setMessageIsError(isError);
  };

  const handleConnect = async () => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setSigningIn(true);
    showMessage('브라우저에서 Google 로그인을 마쳐 주세요. 창을 닫았다면 버튼을 다시 누르세요.');
    try {
      await onConnect();
      if (attempt !== attemptRef.current) return;
      showMessage('Gmail 연결이 완료되었습니다.');
    } catch (error) {
      // A sign-in replaced by a newer click ends quietly; the newer one reports.
      if (attempt !== attemptRef.current) return;
      showMessage(ipcErrorMessage(error, 'Gmail 연결에 실패했습니다.'), true);
    } finally {
      if (attempt === attemptRef.current) setSigningIn(false);
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

  return { busy, signingIn, message, messageIsError, handleConnect, handleDisconnect };
}
