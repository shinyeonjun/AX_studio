import { ipcMain } from 'electron';
import { printHtmlToPdf } from '../document-print.js';

export function registerUtilityHandlers() {
  ipcMain.handle('ax:printPdf', async (_e, html: unknown) => {
    if (typeof html !== 'string') throw new Error('PDF로 변환할 HTML 형식이 올바르지 않습니다.');
    return printHtmlToPdf(html);
  });
}
