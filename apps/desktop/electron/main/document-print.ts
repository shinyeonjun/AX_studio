import { BrowserWindow, session } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRINT_LOAD_TIMEOUT_MS = 15_000;
/** Reports embed page images as data: URIs, so allow large documents now that they load from a file. */
const MAX_PRINT_HTML_CHARS = 50_000_000;
let printSessionInstance: ReturnType<typeof session.fromPartition> | undefined;
let printSessionConfigured = false;
/** Exact file URLs of in-flight print documents; every other file:// request is cancelled. */
const allowedPrintFiles = new Set<string>();

function getPrintSession() {
  return printSessionInstance ??= session.fromPartition('temp:ax-print', { cache: false });
}

function normalizedFileUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return undefined;
    parsed.hash = '';
    parsed.search = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

function configurePrintSession(): void {
  if (printSessionConfigured) return;
  const printSession = getPrintSession();
  printSessionConfigured = true;
  printSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (details.url.startsWith('data:')) {
      callback({ cancel: false });
      return;
    }
    const fileUrl = normalizedFileUrl(details.url);
    callback({ cancel: !(fileUrl && allowedPrintFiles.has(fileUrl)) });
  });
}

export async function printHtmlToPdf(html: string, _options?: { title?: string }): Promise<Buffer> {
  if (html.length > MAX_PRINT_HTML_CHARS) throw new Error('PDF HTML이 너무 큽니다.');
  configurePrintSession();
  const printSession = getPrintSession();

  // A data: URL caps out around 2 MB in Chromium; load a private temp file instead.
  const directory = await mkdtemp(join(tmpdir(), 'ax-print-'));
  const htmlPath = join(directory, 'document.html');
  const fileUrl = normalizedFileUrl(pathToFileURL(htmlPath).href)!;
  let win: BrowserWindow | undefined;
  try {
    await writeFile(htmlPath, html, { encoding: 'utf8', mode: 0o600 });
    allowedPrintFiles.add(fileUrl);
    win = new BrowserWindow({
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
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        win.loadFile(htmlPath),
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
    allowedPrintFiles.delete(fileUrl);
    win?.destroy();
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
