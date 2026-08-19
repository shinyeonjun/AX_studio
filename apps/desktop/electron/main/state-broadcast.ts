import { getMainWindow } from './app-window.js';

export function notifyStateChanged() {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('ax:state-changed');
}
