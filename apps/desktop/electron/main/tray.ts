/// <reference types="electron-vite/node" />
import { app, Tray, Menu, nativeImage } from 'electron';
import appIconPath from '../../build/icon.png?asset';
import { getCore } from './core-instance';
import { setQuiting, showMainWindow } from './app-window';
import { desktopAppDisplayName } from './data-paths.js';

let tray: Tray | null = null;

function trayIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(appIconPath);
  if (image.isEmpty()) {
    console.warn('[AX Studio] tray icon missing; using an empty image');
    return image;
  }
  // Windows/macOS menu bars use 16pt; Linux status areas typically 22-24px.
  const size = process.platform === 'linux' ? 24 : 16;
  return image.resize({ width: size, height: size, quality: 'best' });
}

export function createTray() {
  tray = new Tray(trayIcon());
  const appName = desktopAppDisplayName();
  const menu = Menu.buildFromTemplate([
    { label: `${appName} 열기`, click: () => showMainWindow() },
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
  tray.on('click', () => showMainWindow());
}
