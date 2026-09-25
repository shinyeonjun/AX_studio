import { BrowserWindow, session } from 'electron';

const PRINT_LOAD_TIMEOUT_MS = 15_000;
const MAX_PRINT_HTML_CHARS = 5_000_000;
let printSessionInstance: ReturnType<typeof session.fromPartition> | undefined;
let printSessionConfigured = false;

function getPrintSession() {
  return printSessionInstance ??= session.fromPartition('temp:ax-print', { cache: false });
}

function configurePrintSession(): void {
  if (printSessionConfigured) return;
  const printSession = getPrintSession();
  printSessionConfigured = true;
  printSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !details.url.startsWith('data:') });
  });
}

export async function printHtmlToPdf(html: string, _options?: { title?: string }): Promise<Buffer> {
  if (html.length > MAX_PRINT_HTML_CHARS) throw new Error('PDF HTML이 너무 큽니다.');
  configurePrintSession();
  const printSession = getPrintSession();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: false,
      webSecurity: true,
      session: printSession,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('PDF HTML 로드 시간이 초과되었습니다.')), PRINT_LOAD_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    win.destroy();
  }
}
