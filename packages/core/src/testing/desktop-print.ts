import type { DesktopPrintBridge, DesktopPrintOptions } from '../documents/write/desktop-print.js';

export class MockDesktopPrintBridge implements DesktopPrintBridge {
  readonly prints: Array<{ html: string; options?: DesktopPrintOptions }> = [];

  async printHtml(html: string, options?: DesktopPrintOptions): Promise<Buffer> {
    this.prints.push({ html, options });
    return Buffer.from(`mock-pdf:${options?.title ?? 'report'}`);
  }
}
