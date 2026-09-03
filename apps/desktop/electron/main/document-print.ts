import { BrowserWindow } from 'electron';

export async function printHtmlToPdf(html: string, _options?: { title?: string }): Promise<Buffer> {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
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
