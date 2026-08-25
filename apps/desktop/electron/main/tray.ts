import { app, Tray, Menu, nativeImage } from 'electron';
import { getCore } from './core-instance';
import { getMainWindow, setQuiting } from './app-window';
import { desktopAppDisplayName } from './data-paths.js';

let tray: Tray | null = null;

export function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const appName = desktopAppDisplayName();
  const menu = Menu.buildFromTemplate([
    { label: `${appName} 열기`, click: () => getMainWindow()?.show() },
    {
      label: '출근',
      click: () => {
        const core = getCore();
        core.store.setSetting('globalActive', true);
        core.runtime.setGlobalActive(true);
      },
    },
    {
      label: '퇴근',
      click: () => {
        const core = getCore();
        core.store.setSetting('globalActive', false);
        core.runtime.setGlobalActive(false);
      },
    },
    {
      label: '종료',
      click: () => {
        setQuiting(true);
        app.quit();
      },
    },
  ]);
  tray.setToolTip(appName);
  tray.setContextMenu(menu);
  tray.on('click', () => getMainWindow()?.show());
}
