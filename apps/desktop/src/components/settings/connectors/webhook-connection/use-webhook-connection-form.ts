import { useRef, useState } from 'react';
import type { AppState } from '../../../../types/app-state';
import { confirmDisconnectConnector } from '../../../../lib/confirm-delete';
import { connectionEntry } from '../../../../lib/connection-display';

export interface WebhookConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onConnect: (payload: { port: number; secret: string; label?: string; tunnelUrl?: string }) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

type WebhookConnectionControllerProps = Pick<WebhookConnectionFormProps, 'state' | 'onConnect' | 'onDisconnect'>;

export function useWebhookConnectionForm({
  state,
  onConnect,
  onDisconnect,
}: WebhookConnectionControllerProps) {
  const webhookEntry = connectionEntry(state, 'webhook');
  const connected = Boolean(webhookEntry?.connected);
  const formRef = useRef<HTMLDivElement>(null);
  const [port, setPort] = useState('18789');
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadFromConnection = () => {
    if (!webhookEntry?.connected) return;
    if (webhookEntry.port != null) setPort(String(webhookEntry.port));
    setLabel(webhookEntry.label ?? '');
    setTunnelUrl(webhookEntry.tunnelUrl ?? '');
    setSecret('');
    setMessage('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const connectedItems =
    connected && webhookEntry?.port != null
      ? [
          {
            id: 'webhook',
            title: webhookEntry.label?.trim() || 'Webhook',
            subtitle: webhookEntry.localBaseUrl ?? `http://127.0.0.1:${webhookEntry.port}/hooks/`,
            meta: webhookEntry.tunnelUrl ? `터널: ${webhookEntry.tunnelUrl}` : `포트 ${webhookEntry.port}`,
          },
        ]
      : [];

  const handleConnect = async () => {
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort)) {
      setMessage('포트 번호가 올바르지 않습니다.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await onConnect({
        port: parsedPort,
        secret,
        label: label.trim() || undefined,
        tunnelUrl: tunnelUrl.trim() || undefined,
      });
      setMessage('Webhook 리스너가 시작되었습니다.');
      setSecret('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Webhook 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirmDisconnectConnector('Webhook 수신')) return;
    setBusy(true);
    setMessage('');
    try {
      await onDisconnect();
      setMessage('Webhook 리스너가 중지되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return {
    formRef,
    connected,
    port,
    setPort,
    secret,
    setSecret,
    label,
    setLabel,
    tunnelUrl,
    setTunnelUrl,
    busy,
    message,
    lastError: webhookEntry?.lastError,
    connectedItems,
    localExample: `http://127.0.0.1:${port || '18789'}/hooks/{path}`,
    loadFromConnection,
    handleConnect,
    handleDisconnect,
  };
}
