import { app } from 'electron';
import { ipcHandle } from '../ipc/ipc-handle.js';

/** Passed by the login item: the app starts in the tray, without opening its window. */
export const START_HIDDEN_ARG = '--start-hidden';

export function startedHidden(argv: readonly string[] = process.argv): boolean {
  return argv.includes(START_HIDDEN_ARG);
}

export type StartAtLogin = { supported: false } | { supported: true; enabled: boolean };

/**
 * Whether the app starts when the person signs in to the computer, so recurring work runs on time
 * after a restart. Windows and macOS keep this setting; a development run has no installed app to
 * register, and Linux desktops differ too much to set it reliably.
 */
function supported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

export function getStartAtLogin(): StartAtLogin {
  if (!supported()) return { supported: false };
  return { supported: true, enabled: app.getLoginItemSettings({ args: [START_HIDDEN_ARG] }).openAtLogin };
}

export function setStartAtLogin(enabled: boolean): StartAtLogin {
  if (!supported()) return { supported: false };
  app.setLoginItemSettings({ openAtLogin: enabled, args: [START_HIDDEN_ARG] });
  return getStartAtLogin();
}

export function registerLoginItemHandlers(): void {
  ipcHandle('ax:getStartAtLogin', async (): Promise<StartAtLogin> => getStartAtLogin());
  ipcHandle('ax:setStartAtLogin', async (_event, enabled: unknown): Promise<StartAtLogin> => {
    if (typeof enabled !== 'boolean') throw new Error('자동 시작 설정 값이 올바르지 않아요.');
    return setStartAtLogin(enabled);
  });
}
