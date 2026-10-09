import { KEEP_CONTENT_LOCAL_SETTING } from '@ax-studio/core';
import { getCore } from '../core-instance.js';
import { ipcHandle } from '../ipc/ipc-handle.js';

/** The person's choice to keep work content (mail, documents, read results) off cloud services. */
export function registerPrivacyHandlers(): void {
  ipcHandle('ax:getKeepContentLocal', async (): Promise<boolean> =>
    getCore().store.getSetting<unknown>(KEEP_CONTENT_LOCAL_SETTING, false) === true);
  ipcHandle('ax:setKeepContentLocal', async (_event, enabled: unknown): Promise<boolean> => {
    if (typeof enabled !== 'boolean') throw new Error('설정 값이 올바르지 않아요.');
    getCore().store.setSetting(KEEP_CONTENT_LOCAL_SETTING, enabled);
    return enabled;
  });
}
