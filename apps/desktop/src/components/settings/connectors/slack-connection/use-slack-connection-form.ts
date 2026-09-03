import { useState } from 'react';
import type { AppState } from '../../../../types/app-state';
import { confirmDisconnectConnector } from '../../../../lib/confirm-delete';

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

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        token: slackToken,
        appToken: appToken.trim() || undefined,
      });
      setMessage(
        realtimeTriggers
          ? 'Slack 연결이 완료되었습니다.'
          : 'Slack 연결을 갱신했습니다. 실시간 트리거 상태를 확인하세요.',
      );
      setSlackToken('');
      setAppToken('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Slack 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;
    if (!confirmDisconnectConnector('Slack')) return;
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('Slack 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Slack 연결 해제에 실패했습니다.');
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
    handleConnect,
    handleDisconnect,
  };
}
