export interface DesktopPrintOptions {
  title?: string;
}

/** Desktop-only HTML → PDF (Chromium printToPDF). Injected by Electron main; absent in core-only tests. */
export interface DesktopPrintBridge {
  printHtml(html: string, options?: DesktopPrintOptions): Promise<Buffer>;
}

let configuredBridge: DesktopPrintBridge | null = null;

export function setDesktopPrintBridge(bridge: DesktopPrintBridge | null): void {
  configuredBridge = bridge;
}

export function getDesktopPrintBridge(): DesktopPrintBridge | null {
  return configuredBridge;
}

export class MockDesktopPrintBridge implements DesktopPrintBridge {
  readonly prints: Array<{ html: string; options?: DesktopPrintOptions }> = [];

  async printHtml(html: string, options?: DesktopPrintOptions): Promise<Buffer> {
    this.prints.push({ html, options });
    return Buffer.from(`mock-pdf:${options?.title ?? 'report'}`);
  }
}
