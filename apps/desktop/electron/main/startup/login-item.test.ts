import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  let openAtLogin = false;
  return {
    app: {
      isPackaged: true,
      getLoginItemSettings: vi.fn(() => ({ openAtLogin })),
      setLoginItemSettings: vi.fn((settings: { openAtLogin: boolean }) => { openAtLogin = settings.openAtLogin; }),
    },
    reset: () => { openAtLogin = false; },
  };
});
vi.mock('electron', () => ({ app: electron.app }));
vi.mock('../ipc/ipc-handle.js', () => ({ ipcHandle: vi.fn() }));

import { getStartAtLogin, setStartAtLogin, START_HIDDEN_ARG, startedHidden } from './login-item.js';

const platform = process.platform;
beforeEach(() => {
  electron.reset();
  electron.app.isPackaged = true;
  Object.defineProperty(process, 'platform', { value: platform });
});

describe('starting with the computer', () => {
  it('registers a start in the tray, without the window', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(setStartAtLogin(true)).toEqual({ supported: true, enabled: true });
    expect(electron.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: [START_HIDDEN_ARG] });
    expect(startedHidden(['app.exe', START_HIDDEN_ARG])).toBe(true);
    expect(startedHidden(['app.exe'])).toBe(false);
  });

  it('is not offered where it cannot be kept', () => {
    electron.app.isPackaged = false;
    expect(getStartAtLogin()).toEqual({ supported: false });
    electron.app.isPackaged = true;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(setStartAtLogin(true)).toEqual({ supported: false });
    expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});
