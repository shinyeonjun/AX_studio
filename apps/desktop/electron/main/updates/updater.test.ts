import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from './status.js';
import { DesktopUpdates, type AppUpdaterLike } from './updater.js';

function fakeUpdater() {
  const events = new EventEmitter();
  const updater = {
    autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false,
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
  };
  return { updater: updater as unknown as AppUpdaterLike & typeof updater, emit: (event: string, value?: unknown) => events.emit(event, value) };
}

function controller(version = '0.1.0') {
  const fake = fakeUpdater();
  const statuses: UpdateStatus[] = [];
  const log = vi.fn();
  const updates = new DesktopUpdates(fake.updater, { currentVersion: version, onStatus: (status) => statuses.push(status), log });
  return { ...fake, updates, statuses, log };
}

describe('desktop updates', () => {
  it('downloads quietly in the background and installs when the app quits', () => {
    const { updater } = controller();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.allowPrerelease).toBe(false);
  });

  it('a preview build follows preview releases', () => {
    expect(controller('0.1.0-preview.1').updater.allowPrerelease).toBe(true);
  });

  it('says when a newer version is downloading and when it is ready', () => {
    const { emit, statuses, updates } = controller();
    emit('update-available', { version: '0.2.0' });
    emit('download-progress', { percent: 41.6 });
    emit('update-downloaded', { version: '0.2.0' });
    expect(statuses.map((status) => status.state)).toEqual(['downloading', 'downloading', 'ready']);
    expect(statuses[1]).toMatchObject({ percent: 42 });
    expect(updates.current()).toEqual({ state: 'ready', version: '0.2.0', currentVersion: '0.1.0' });
  });

  it('restarts only when an update is ready, and only when asked', () => {
    const { emit, updater, updates } = controller();
    expect(updates.installNow()).toBe(false);
    emit('update-downloaded', { version: '0.2.0' });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updates.installNow()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('logs a failed check without reporting it, and keeps a ready update ready', async () => {
    const { emit, updater, updates, log, statuses } = controller();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await updates.check();
    expect(log).toHaveBeenCalledWith('update check failed', { message: 'offline' });
    emit('update-downloaded', { version: '0.2.0' });
    emit('error', new Error('later failure'));
    expect(statuses.at(-1)?.state).toBe('ready');
  });

  it('does not check again while a download is under way or ready', async () => {
    const { emit, updater, updates } = controller();
    emit('update-available', { version: '0.2.0' });
    await updates.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
