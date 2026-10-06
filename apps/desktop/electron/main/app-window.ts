import { app, BrowserWindow, dialog, Notification, session, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktopAppDisplayName } from './data-paths.js';
import { createCrashLoopGuard, RENDERER_CRASH_POLICY } from './diagnostics/crash-guard.js';
import { externalHttpsUrl, isRendererPermissionAllowed } from './diagnostics/shell-policy.js';

function isLocalDevRendererOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

let externalLinkPromptOpen = false;

/** https links leave the app only through the OS browser, after the user sees the full URL. */
async function confirmAndOpenExternal(rawUrl: string): Promise<void> {
  const url = externalHttpsUrl(rawUrl);
  if (!url) {
    console.warn('[AX Studio] blocked navigation to non-https URL');
    return;
  }
  if (externalLinkPromptOpen) return;
  externalLinkPromptOpen = true;
  try {
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['브라우저에서 열기', '취소'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: '외부 링크 열기',
      message: '다음 주소를 기본 브라우저에서 열까요?',
      detail: url,
    };
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (response === 0) await shell.openExternal(url);
  } catch (err) {
    console.error('[AX Studio] 외부 링크 열기 실패:', err);
  } finally {
    externalLinkPromptOpen = false;
  }
}

function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    void confirmAndOpenExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    void confirmAndOpenExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

let sessionHardened = false;

function hardenDefaultSession(): void {
  if (sessionHardened) return;
  sessionHardened = true;
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback) => {
    const allowed = isRendererPermissionAllowed(permission, contents?.getURL(), isTrustedRendererUrl);
    if (!allowed) console.warn(`[AX Studio] denied renderer permission request: ${permission}`);
    callback(allowed);
  });
  ses.setPermissionCheckHandler((contents, permission) =>
    isRendererPermissionAllowed(permission, contents?.getURL(), isTrustedRendererUrl));
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
let trayHintShown = false;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setQuiting(value: boolean) {
  isQuiting = value;
}

function loadRenderer(window: BrowserWindow): void {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function watchRendererHealth(window: BrowserWindow): void {
  const rendererCrashes = createCrashLoopGuard(RENDERER_CRASH_POLICY);
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[AX Studio] renderer process gone:', details.reason, `exitCode=${details.exitCode}`);
    if (isQuiting || details.reason === 'clean-exit' || window.isDestroyed()) return;
    if (rendererCrashes.record()) {
      console.warn('[AX Studio] reloading renderer after process loss');
      loadRenderer(window);
      return;
    }
    console.error('[AX Studio] renderer crash loop detected; automatic reload stopped');
    dialog.showErrorBox(
      `${desktopAppDisplayName()} 화면 오류`,
      '화면 프로세스가 반복해서 종료되어 자동 복구를 중단했습니다. 앱을 다시 시작해 주세요.',
    );
  });
  window.on('unresponsive', () => console.warn('[AX Studio] renderer became unresponsive'));
  window.on('responsive', () => console.warn('[AX Studio] renderer became responsive again'));
}

function showTrayHintOnce(): void {
  if (trayHintShown) return;
  trayHintShown = true;
  if (!Notification.isSupported()) return;
  new Notification({
    title: desktopAppDisplayName(),
    body: '트레이에서 계속 실행 중입니다. 완전히 끄려면 트레이 아이콘 메뉴에서 종료를 선택하세요.',
    silent: true,
  }).show();
}

export function createMainWindow() {
  hardenDefaultSession();
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
      webviewTag: false,
      additionalArguments: e2eRendererStubsEnabled() ? ['--ax-e2e-stubs'] : [],
    },
  });

  hardenWebContents(mainWindow.webContents);
  watchRendererHealth(mainWindow);
  loadRenderer(mainWindow);

  mainWindow.on('close', (e) => {
    if (!isQuiting) {
      e.preventDefault();
      mainWindow?.hide();
      showTrayHintOnce();
    }
  });
}

/** E2E-only IPC stubs in the preload: never in a packaged app, whatever the environment says. */
function e2eRendererStubsEnabled(): boolean {
  return !app.isPackaged && process.env.AX_E2E === '1';
}

export function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
