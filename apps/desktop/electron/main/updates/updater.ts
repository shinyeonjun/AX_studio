import type { UpdateStatus } from './status.js';

/** The part of electron-updater's AppUpdater this app uses; a fake stands in for tests. */
export interface AppUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/** A status without the version this app runs, which the controller adds. */
type StatusChange = UpdateStatus extends infer Status ? Status extends UpdateStatus ? Omit<Status, 'currentVersion'> : never : never;

/**
 * Checks for a newer release, downloads it in the background and says when it is ready. It never
 * restarts on its own: work may be running. A downloaded update is installed when the app quits, or
 * at once if the person asks. A failed check is logged and retried later, never shown as an error:
 * an offline laptop is not a problem to report.
 */
export class DesktopUpdates {
  private status: UpdateStatus;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly updater: AppUpdaterLike,
    private readonly options: {
      currentVersion: string;
      onStatus: (status: UpdateStatus) => void;
      log: (message: string, data?: Record<string, unknown>) => void;
    },
  ) {
    this.status = { state: 'idle', currentVersion: options.currentVersion };
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    // A preview build follows preview releases; a stable build stays on stable ones.
    updater.allowPrerelease = options.currentVersion.includes('-');
    updater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }));
    updater.on('download-progress', (progress) => {
      if (this.status.state === 'downloading') this.set({ ...this.status, percent: Math.round(progress.percent) });
    });
    updater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }));
    updater.on('update-not-available', () => {
      if (this.status.state !== 'ready') this.set({ state: 'idle' });
    });
    updater.on('error', (error) => {
      options.log('update check failed', { message: error.message.slice(0, 300) });
      if (this.status.state !== 'ready') this.set({ state: 'idle' });
    });
  }

  current(): UpdateStatus {
    return this.status;
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => { void this.check(); }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<void> {
    if (this.status.state === 'ready' || this.status.state === 'downloading') return;
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.options.log('update check failed', { message: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  }

  /** Restart into the downloaded version; nothing happens unless one is ready. */
  installNow(): boolean {
    if (this.status.state !== 'ready') return false;
    this.updater.quitAndInstall(false, true);
    return true;
  }

  private set(next: StatusChange): void {
    this.status = { ...next, currentVersion: this.options.currentVersion } as UpdateStatus;
    this.options.onStatus(this.status);
  }
}
