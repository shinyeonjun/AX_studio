import { getMainWindow } from './app-window.js';
import type { WorkspaceChatChangedEvent, WorkspaceSourceRecord } from '@ax-studio/core';

export interface WorkspaceSourceChangedPayload {
  sessionId: string;
  source: WorkspaceSourceRecord;
}

export function notifyStateChanged() {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('ax:state-changed');
}

export function notifyWorkspaceSourceChanged(source: WorkspaceSourceRecord) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  const payload: WorkspaceSourceChangedPayload = {
    sessionId: source.sessionId,
    source,
  };
  win.webContents.send('ax:workspace-source-changed', payload);
}

export function notifyWorkspaceChatChanged(event: WorkspaceChatChangedEvent) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('ax:workspace-chat-changed', event);
}
