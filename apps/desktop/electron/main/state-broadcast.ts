import { getMainWindow } from './app-window.js';
import type { WorkspaceChatChangedEvent, WorkspaceSourceRecord } from '@ax-studio/core';

interface WorkspaceSourceChangedPayload {
  sessionId: string;
  source: WorkspaceSourceRecord;
}

/**
 * A run emits a change per step; every notification makes the renderer rebuild the whole app state.
 * The first change is sent at once, later ones within the window collapse into one trailing send,
 * so the renderer always ends on the latest state.
 */
export const STATE_CHANGED_THROTTLE_MS = 100;
let throttleTimer: ReturnType<typeof setTimeout> | undefined;
let changedDuringThrottle = false;

function sendStateChanged() {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('ax:state-changed');
}

export function notifyStateChanged() {
  if (throttleTimer) {
    changedDuringThrottle = true;
    return;
  }
  sendStateChanged();
  const settle = () => {
    if (!changedDuringThrottle) {
      throttleTimer = undefined;
      return;
    }
    changedDuringThrottle = false;
    sendStateChanged();
    throttleTimer = setTimeout(settle, STATE_CHANGED_THROTTLE_MS);
    throttleTimer.unref?.();
  };
  throttleTimer = setTimeout(settle, STATE_CHANGED_THROTTLE_MS);
  // A pending trailing send must not hold the app open at quit.
  throttleTimer.unref?.();
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
