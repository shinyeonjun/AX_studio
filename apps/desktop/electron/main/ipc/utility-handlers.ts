import { BrowserWindow, ipcMain } from 'electron';

export function registerUtilityHandlers() {
  ipcMain.handle('ax:printPdf', async (_e, html: string) => {
    const win = new BrowserWindow({ show: false });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({});
    win.destroy();
    return pdf;
  });
}
