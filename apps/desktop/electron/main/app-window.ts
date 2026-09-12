import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktopAppDisplayName } from './data-paths.js';

const DEV_RENDERER_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

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
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      const configured = new URL(process.env.ELECTRON_RENDERER_URL);
      return DEV_RENDERER_ORIGINS.has(new URL(url).origin) &&
        new URL(url).origin === configured.origin;
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

  if (process.env.ELECTRON_RENDERER_URL) {
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
