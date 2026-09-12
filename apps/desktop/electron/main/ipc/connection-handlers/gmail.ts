import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { connectGmailOAuth, disconnectGmailOAuth } from '../../gmail/connection.js';
import { dialog } from 'electron';
import { open } from 'node:fs/promises';
import { clearGoogleDesktopClient, saveGoogleDesktopClient } from '../../gmail/oauth-client.js';
import { notifyStateChanged } from '../../state-broadcast.js';

let mutationActive = false;
async function mutate<T>(operation: () => Promise<T>): Promise<T> {
  if (mutationActive) throw new Error('Gmail 설정을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  mutationActive = true;
  try { return await operation(); }
  finally { mutationActive = false; notifyStateChanged(); }
}

function assertDisconnected(): void {
  if (getCore().store.getConnections().some(entry => entry.connector === 'gmail' && entry.connected)) {
    throw new Error('OAuth 클라이언트를 변경하려면 먼저 Gmail 연결을 해제해 주세요.');
  }
}

export function registerGmailConnectionHandlers() {
  ipcHandle('ax:connectGmailOAuth', () => mutate(async () => {
    const core = getCore();
    return connectGmailOAuth(core.store, core.runtime);
  }));
  ipcHandle('ax:disconnectGmailOAuth', () => mutate(async () => {
    const core = getCore();
    return disconnectGmailOAuth(core.store, core.runtime);
  }));
  ipcHandle('ax:importGmailOAuthClient', () => mutate(async () => {
    assertDisconnected();
    const selected = await dialog.showOpenDialog({ title: 'Google 데스크톱 앱 OAuth 클라이언트 JSON',
      properties: ['openFile'], filters: [{ name: 'Google OAuth JSON', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
    const file = await open(selected.filePaths[0], 'r');
    try {
      const buffer = Buffer.alloc(65_537);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 65_536) throw new Error('OAuth JSON 파일이 너무 큽니다.');
      await saveGoogleDesktopClient(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally { await file.close(); }
    return { ok: true };
  }));
  ipcHandle('ax:clearGmailOAuthClient', () => mutate(async () => {
    assertDisconnected();
    await clearGoogleDesktopClient();
    return { ok: true };
  }));
}
