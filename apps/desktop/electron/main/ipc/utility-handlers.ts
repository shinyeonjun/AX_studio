import { ipcHandle } from './ipc-handle.js';
import { printHtmlToPdf } from '../document-print.js';

const MAX_PRINT_HTML_CHARS = 5_000_000;

export function registerUtilityHandlers() {
  ipcHandle('ax:printPdf', async (_e, html: unknown) => {
    if (typeof html !== 'string') throw new Error('PDF로 변환할 HTML 형식이 올바르지 않습니다.');
    if (html.length > MAX_PRINT_HTML_CHARS) throw new Error('PDF HTML이 너무 큽니다.');
    return printHtmlToPdf(html);
  });
}
