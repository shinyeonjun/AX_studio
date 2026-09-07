import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanFolder, scanFolderChecked } from '../../platform/local-folder-scan.js';
import { buildLocalFolderResources } from './resources.js';
import { LocalFolderConnector } from './connector.js';
import type { LocalFolderEntry } from '../../platform/local-folder-config.js';

const fault = vi.hoisted(() => ({ operation: '', path: '', code: '' }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const guard = (operation: string, args: unknown[]) => {
    if (operation === fault.operation && String(args[0]) === fault.path) {
      throw Object.assign(new Error(`${fault.code}: private filesystem detail ${fault.path}`), { code: fault.code });
    }
  };
  return {
    ...actual,
    readdirSync: (...args: unknown[]) => { guard('readdir', args); return Reflect.apply(actual.readdirSync, actual, args); },
    lstatSync: (...args: unknown[]) => { guard('lstat', args); return Reflect.apply(actual.lstatSync, actual, args); },
  };
});

const unavailable = { ok: false, error: 'folder_scan_incomplete', errorCode: 'incomplete_scan' };

describe.each([
  { operation: 'readdir', code: 'EACCES' },
  { operation: 'readdir', code: 'ENOENT' },
  { operation: 'lstat', code: 'EACCES' },
  { operation: 'lstat', code: 'ENOENT' },
])('descendant scan failures: $operation $code', ({ operation, code }) => {
  let root: string;
  let folder: LocalFolderEntry;
  let visiblePath: string;
  let hiddenPath: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ax-descendant-failure-'));
    const child = join(root, 'z-private-child');
    mkdirSync(child);
    visiblePath = join(root, 'a-visible.txt');
    hiddenPath = join(child, 'private-file.txt');
    writeFileSync(visiblePath, 'visible');
    writeFileSync(hiddenPath, 'hidden');
    folder = { id: 'selected', path: root, label: 'Selected', addedAt: new Date(0).toISOString() };
    Object.assign(fault, { operation, code, path: operation === 'readdir' ? child : hiddenPath });
    vi.stubEnv('AX_SCAN_SYNC', '1');
  });
  afterEach(() => {
    Object.assign(fault, { operation: '', path: '', code: '' });
    vi.unstubAllEnvs();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('rejects a partial checked scan while preserving the tolerant legacy listing', () => {
    const legacy = scanFolder(root);
    expect(legacy.map(file => file.filePath)).toEqual([visiblePath]);
    expect(scanFolderChecked(root)).toEqual(unavailable);
  });

  it('returns a complete checked scan after access is restored', () => {
    expect(scanFolderChecked(root)).toEqual(unavailable);
    fault.operation = '';
    const recovered = scanFolderChecked(root);
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(recovered.files.map(file => file.filePath)).toEqual([visiblePath, hiddenPath]);
  });

  it('does not expose a partial resource page, a continuation, or raw failure details', () => {
    expect(() => buildLocalFolderResources([folder], { offset: 0, limit: 1 }))
      .toThrowError(new Error('folder_scan_incomplete'));
  });

  it('propagates the sanitized error through async list', async () => {
    const connector = new LocalFolderConnector({ folders: [folder] });
    const context = { executionId: 'scan', variables: {}, log: vi.fn() };
    expect(await connector.execute('list', { folderId: folder.id, limit: 1 }, context)).toEqual(unavailable);
    expect(context.log).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not create a cursor or emit events when initialized=%s', async initialized => {
    const connector = new LocalFolderConnector({ folders: [folder] });
    const context = { executionId: 'scan', variables: {}, log: vi.fn() };
    const params = { folderId: folder.id, initialized, seenFileKeys: [hiddenPath] };
    expect(await connector.execute('new_file.poll', params, context)).toEqual(unavailable);
    expect(params).toEqual({ folderId: folder.id, initialized, seenFileKeys: [hiddenPath] });
    expect(context.log).not.toHaveBeenCalled();
  });
});
