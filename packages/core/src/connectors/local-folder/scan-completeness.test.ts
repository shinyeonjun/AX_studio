import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFolderConnector } from './connector.js';
import { buildLocalFolderResources } from './resources.js';
import { MAX_FILES_PER_SCAN } from '../../platform/local-folder-scan.js';
import type { LocalFolderEntry } from '../../platform/local-folder-config.js';

describe('bounded folder scans', () => {
  let root: string;
  let folder: LocalFolderEntry;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ax-scan-completeness-'));
    folder = { id: 'selected', path: root, label: 'Selected', addedAt: new Date(0).toISOString() };
    for (let index = 0; index <= MAX_FILES_PER_SCAN; index += 1) {
      writeFileSync(join(root, `${String(index).padStart(5, '0')}.txt`), '');
    }
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('does not present the scanner ceiling as a complete resource inventory', () => {
    const [resource] = buildLocalFolderResources([folder], { maxFilesPerFolder: MAX_FILES_PER_SCAN });
    expect(resource).toMatchObject({ totalFileCount: MAX_FILES_PER_SCAN, truncated: true });
  });

  it.each([NaN, Infinity, -1])('bounds an invalid resource preview size: %s', maxFilesPerFolder => {
    const [resource] = buildLocalFolderResources([folder], { maxFilesPerFolder });
    expect(resource!.files.length).toBeLessThanOrEqual(40);
    expect(resource!.truncated).toBe(true);
  });

  it('exposes incomplete listing metadata and does not advance a poll cursor over an incomplete scan', async () => {
    const connector = new LocalFolderConnector({ folders: [folder] });
    const context = { executionId: 'scan', variables: {}, log: () => {} };
    const listed = await connector.execute('list', { folderId: folder.id }, context);
    expect(listed.ok).toBe(true);
    const metadata = listed.data as { truncated?: boolean; completeness?: unknown };
    expect({ truncated: metadata.truncated, completeness: metadata.completeness }).toMatchObject({
      truncated: true, completeness: { status: 'unknown', reason: 'provider_limit' },
    });
    expect(await connector.execute('new_file.poll', { folderId: folder.id }, context)).toMatchObject({
      ok: false, error: 'folder_scan_limit', errorCode: 'incomplete_scan',
    });
  });

  it('pages the observed inventory and distinguishes its count from an exact total', async () => {
    const connector = new LocalFolderConnector({ folders: [folder] });
    const result = await connector.execute('list', { folderId: folder.id, offset: 100, limit: 25 },
      { executionId: 'page', variables: {}, log: () => {} });
    expect(result.ok).toBe(true);
    const page = result.data as { files: unknown[]; nextOffset?: number; scanLimitReached?: boolean; totalFileCountIsExact?: boolean };
    expect(page.files).toHaveLength(25);
    expect(page.nextOffset).toBe(125);
    expect(page.scanLimitReached).toBe(true);
    expect(page.totalFileCountIsExact).toBe(false);
    const [resource] = buildLocalFolderResources([folder], { offset: 100, limit: 25 });
    expect(resource!.files).toHaveLength(25);
    expect(resource).toMatchObject({ offset: 100, limit: 25, nextOffset: 125, scanLimitReached: true, totalFileCountIsExact: false });
    const [last] = buildLocalFolderResources([folder], { offset: 4_999, limit: 25 });
    expect(last!.files).toHaveLength(1);
    expect(last).not.toHaveProperty('nextOffset');
    expect(last).toMatchObject({ truncated: true, scanLimitReached: true });
  });
});
