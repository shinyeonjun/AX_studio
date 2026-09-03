import { ipcMain } from 'electron';
import { getCore } from '../core-instance.js';
import { buildAppState } from './state-handlers/build-state.js';

export function registerStateHandlers() {
  ipcMain.handle('ax:getState', async () => buildAppState(getCore()));
}
