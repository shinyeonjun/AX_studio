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
  if (!trimmed) return connected ? undefined : '비밀 키를 입력하거나 무작위 생성 버튼을 눌러 주세요.';
  if (trimmed.length < WEBHOOK_MIN_SECRET_LENGTH) {
    return `비밀 키는 최소 ${WEBHOOK_MIN_SECRET_LENGTH}자 이상이어야 합니다. (현재 ${trimmed.length}자)`;
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
  const [messageIsError, setMessageIsError] = useState(false);
  const showMessage = (text: string, isError = false) => {
    setMessage(text);
    setMessageIsError(isError);
  };
  const [secretVisible, setSecretVisible] = useState(false);

  const loadFromConnection = () => {
    if (!webhookEntry?.connected) return;
    if (webhookEntry.port != null) setPort(String(webhookEntry.port));
    setLabel(webhookEntry.label ?? '');
    setTunnelUrl(webhookEntry.tunnelUrl ?? '');
    setSecret('');
    setSecretVisible(false);
    showMessage('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const connectedItems =
    connected && webhookEntry?.port != null
      ? [
          {
            id: 'webhook',
            title: webhookEntry.label?.trim() || 'Webhook',
            subtitle: webhookEntry.localBaseUrl ?? `http://127.0.0.1:${webhookEntry.port}/hooks/`,
            meta: webhookEntry.tunnelUrl ? `외부 접속 주소: ${webhookEntry.tunnelUrl}` : `포트 ${webhookEntry.port}`,
          },
        ]
      : [];

  const handleConnect = async () => {
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort)) {
      showMessage('포트 번호가 올바르지 않습니다.', true);
      return;
    }
    const secretProblem = webhookSecretError(secret, connected);
    if (secretProblem) {
      showMessage(secretProblem, true);
      return;
    }
    setBusy(true);
    showMessage('');
    try {
      await onConnect({
        port: parsedPort,
        secret,
        label: label.trim() || undefined,
        tunnelUrl: tunnelUrl.trim() || undefined,
      });
      showMessage('외부 신호를 받기 시작했어요.');
      setSecret('');
      setSecretVisible(false);
    } catch (error) {
      showMessage(ipcErrorMessage(error, '외부 신호 받기를 시작하지 못했습니다.'), true);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirmDisconnectConnector('Webhook 수신')) return;
    setBusy(true);
    showMessage('');
    try {
      await onDisconnect();
      showMessage('외부 신호 받기를 멈췄어요.');
    } catch (error) {
      showMessage(ipcErrorMessage(error, '연결 해제에 실패했습니다.'), true);
    } finally {
      setBusy(false);
    }
  };

  const generateSecret = () => {
    setSecret(generateWebhookSecret());
    // Show the generated value once so it can be copied into the sending service.
    setSecretVisible(true);
    showMessage('');
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
    messageIsError,
    lastError: webhookEntry?.lastError,
    connectedItems,
    localExample: `http://127.0.0.1:${port || DEFAULT_WEBHOOK_PORT}/hooks/{path}`,
    loadFromConnection,
    handleConnect,
    handleDisconnect,
  };
}
