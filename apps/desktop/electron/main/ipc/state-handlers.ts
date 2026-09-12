import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';
import { buildAppState } from './state-handlers/build-state.js';

export function registerStateHandlers() {
  ipcHandle('ax:getState', async () => buildAppState(getCore()));
}
