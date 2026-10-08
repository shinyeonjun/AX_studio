import type { WorkflowStore } from '@ax-studio/core';
import { notifyStateChanged } from '../../state-broadcast.js';
import { gmailConnection } from './shared.js';

export const GMAIL_SIGN_IN_EXPIRED = 'Google 로그인이 만료됐어요. 이 Gmail을 다시 연결해 주세요.';

/**
 * Keeps the Gmail connection's "why" in step with Google: an expired or revoked sign-in is
 * written on the connection (settings shows it, the job health note too), and the next call
 * that works clears it. Writes only when the state actually changes.
 */
export function gmailSignInStatusRecorder(store: Pick<WorkflowStore, 'getConnections' | 'setConnection'>) {
  return (signedIn: boolean): void => {
    const connection = gmailConnection(store as WorkflowStore);
    if (!connection?.connected || !connection.config) return;
    const config = connection.config as Record<string, unknown>;
    const expired = config.lastError === GMAIL_SIGN_IN_EXPIRED;
    if (signedIn === !expired) return;
    if (signedIn) {
      const { lastError: _cleared, ...rest } = config;
      store.setConnection('gmail', true, rest);
    } else {
      store.setConnection('gmail', true, { ...config, lastError: GMAIL_SIGN_IN_EXPIRED });
    }
    try { notifyStateChanged(); } catch { /* the screens refresh on their own later */ }
  };
}
