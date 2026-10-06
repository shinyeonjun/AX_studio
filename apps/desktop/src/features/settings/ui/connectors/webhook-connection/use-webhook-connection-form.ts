import { useRef, useState } from 'react';
import type { AppState } from '../../../../../types/app-state';
import { confirmDisconnectConnector } from '../../../../../ui/lib/confirm-delete';
import { connectionEntry } from '../../../../../ui/lib/connection-display';
import { ipcErrorMessage } from '../../../../../ui/lib/ipc-error';

const DEFAULT_WEBHOOK_PORT = '18789';
/** Mirrors core WEBHOOK_MIN_SECRET_LENGTH; the main process enforces it again. */
export const WEBHOOK_MIN_SECRET_LENGTH = 32;
const RANDOM_SECRET_BYTES = 32;

/** 32 random bytes from the Web Crypto CSPRNG, base64url-encoded (43 chars, no padding). */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(RANDOM_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

/** Client-side check matching the main-process rule; empty is allowed only to keep a stored secret. */
export function webhookSecretError(secret: string, connected: boolean): string | undefined {
  const trimmed = secret.trim();
  if (!trimmed) return connected ? undefined : '공유 비밀을 입력하거나 무작위 생성 버튼을 눌러 주세요.';
  if (trimmed.length < WEBHOOK_MIN_SECRET_LENGTH) {
    return `공유 비밀은 최소 ${WEBHOOK_MIN_SECRET_LENGTH}자 이상이어야 합니다. (현재 ${trimmed.length}자)`;
  }
  return undefined;
}

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
  const [port, setPort] = useState(DEFAULT_WEBHOOK_PORT);
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('');
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [secretVisible, setSecretVisible] = useState(false);

  const loadFromConnection = () => {
    if (!webhookEntry?.connected) return;
    if (webhookEntry.port != null) setPort(String(webhookEntry.port));
    setLabel(webhookEntry.label ?? '');
    setTunnelUrl(webhookEntry.tunnelUrl ?? '');
    setSecret('');
    setSecretVisible(false);
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
    const secretProblem = webhookSecretError(secret, connected);
    if (secretProblem) {
      setMessage(secretProblem);
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
      setSecretVisible(false);
    } catch (error) {
      setMessage(ipcErrorMessage(error, 'Webhook 연결에 실패했습니다.'));
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
      setMessage(ipcErrorMessage(error, '연결 해제에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const generateSecret = () => {
    setSecret(generateWebhookSecret());
    // Show the generated value once so it can be copied into the sending service.
    setSecretVisible(true);
    setMessage('');
  };

  return {
    formRef,
    connected,
    port,
    setPort,
    secret,
    setSecret,
    secretVisible,
    setSecretVisible,
    generateSecret,
    secretError: secret.trim() ? webhookSecretError(secret, connected) : undefined,
    label,
    setLabel,
    tunnelUrl,
    setTunnelUrl,
    busy,
    message,
    lastError: webhookEntry?.lastError,
    connectedItems,
    localExample: `http://127.0.0.1:${port || DEFAULT_WEBHOOK_PORT}/hooks/{path}`,
    loadFromConnection,
    handleConnect,
    handleDisconnect,
  };
}
