import { app, Tray, Menu, nativeImage } from 'electron';
import { getCore } from './core-instance';
import { getMainWindow, setQuiting } from './app-window';

let tray: Tray | null = null;

export function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    { label: 'AX Studio 열기', click: () => getMainWindow()?.show() },
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
  tray.setToolTip('AX Studio');
  tray.setContextMenu(menu);
  tray.on('click', () => getMainWindow()?.show());
}
