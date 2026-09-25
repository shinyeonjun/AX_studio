import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktopAppDisplayName } from './data-paths.js';

function isLocalDevRendererOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
}

export function isTrustedRendererUrl(url: string): boolean {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    try {
      const configured = new URL(process.env.ELECTRON_RENDERER_URL);
      const requested = new URL(url);
      // electron-vite moves to the next free port when another checkout is
      // already running. Keep the origin allowlist local while accepting that
      // deterministic, runtime-selected port.
      return isLocalDevRendererOrigin(configured.origin) &&
        requested.origin === configured.origin;
    } catch {
      return false;
    }
  }

  const rendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).toString();
  return url === rendererUrl || url.startsWith(`${rendererUrl}#`) || url.startsWith(`${rendererUrl}?`);
}

let mainWindow: BrowserWindow | null = null;
let isQuiting = false;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setQuiting(value: boolean) {
  isQuiting = value;
}

export function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    title: desktopAppDisplayName(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  hardenWebContents(mainWindow.webContents);

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!isQuiting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

export function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
