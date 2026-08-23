import { BrowserWindow } from 'electron';
import { join } from 'node:path';

const DEV_RENDERER_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (process.env.ELECTRON_RENDERER_URL) {
      try {
        const origin = new URL(url).origin;
        if (DEV_RENDERER_ORIGINS.has(origin)) return;
      } catch {
        // fall through
      }
    }
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });
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
