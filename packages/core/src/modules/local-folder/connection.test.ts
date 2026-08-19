import { describe, expect, it } from 'vitest';
import {
  getLocalFolderConnectionStatus,
  parseLocalFolderConnectionConfig,
  removeLocalFolder,
  upsertLocalFolder,
} from './connection.js';

describe('local-folder connection', () => {
  it('parses folder list config', () => {
    const parsed = parseLocalFolderConnectionConfig({
      folders: [{ id: 'f1', label: 'Docs', path: 'D:/docs', addedAt: '2026-01-01T00:00:00.000Z' }],
    });
    expect(parsed?.folders).toHaveLength(1);
    expect(parsed?.folders[0]?.path).toBe('D:/docs');
  });

  it('upserts and removes folders', () => {
    const first = upsertLocalFolder(null, {
      id: 'f1',
      label: 'A',
      path: '/a',
      addedAt: '2026-01-01T00:00:00.000Z',
    });
    const second = upsertLocalFolder(first, {
      id: 'f2',
      label: 'B',
      path: '/b',
      addedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(second.folders).toHaveLength(2);

    const removed = removeLocalFolder(second, 'f1');
    expect(removed.folders).toHaveLength(1);
    expect(getLocalFolderConnectionStatus(removed, true).folderCount).toBe(1);
  });
});
