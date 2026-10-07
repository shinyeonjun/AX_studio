import { useState } from 'react';
import type { AppState } from '../../../../../types/app-state';
import { confirmDisconnectConnector } from '../../../../../ui/lib/confirm-delete';
import { ipcErrorMessage } from '../../../../../ui/lib/ipc-error';

export interface SlackConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: { token: string; appToken?: string }) => Promise<void>;
  onDisconnect?: () => Promise<void>;
}

type SlackConnectionControllerProps = Pick<SlackConnectionFormProps, 'onConnect' | 'onDisconnect'> & {
  realtimeTriggers: boolean;
};

export function useSlackConnectionForm({
  onConnect,
  onDisconnect,
  realtimeTriggers,
}: SlackConnectionControllerProps) {
  const [slackToken, setSlackToken] = useState('');
  const [appToken, setAppToken] = useState('');
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
      await onConnect({
        token: slackToken,
        appToken: appToken.trim() || undefined,
      });
      showMessage(
        realtimeTriggers
          ? 'Slack 연결이 완료되었습니다.'
          : 'Slack 연결을 갱신했습니다. 새 메시지 자동 감지 상태를 확인하세요.',
      );
      setSlackToken('');
      setAppToken('');
    } catch (error) {
      showMessage(ipcErrorMessage(error, 'Slack 연결에 실패했습니다.'), true);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;
    if (!confirmDisconnectConnector('Slack')) return;
    setBusy(true);
    showMessage('');
    try {
      await onDisconnect();
      showMessage('Slack 연결이 해제되었습니다.');
    } catch (error) {
      showMessage(ipcErrorMessage(error, 'Slack 연결 해제에 실패했습니다.'), true);
    } finally {
      setBusy(false);
    }
  };

  return {
    slackToken,
    setSlackToken,
    appToken,
    setAppToken,
    busy,
    message,
    messageIsError,
    handleConnect,
    handleDisconnect,
  };
}
