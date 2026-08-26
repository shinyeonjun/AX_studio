import { describe, expect, it } from 'vitest';
import {
  findLocalFolder,
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

  it('updates an existing folder when the same Windows path uses different casing and separators', () => {
    const initial = upsertLocalFolder(null, {
      id: 'f1',
      label: 'Old docs',
      path: 'D:\\Docs',
      addedAt: '2026-01-01T00:00:00.000Z',
    });

    const updated = upsertLocalFolder(initial, {
      id: 'f2',
      label: 'Docs',
      path: 'd:/docs',
      addedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(updated.folders).toEqual([
      {
        id: 'f2',
        label: 'Docs',
        path: 'd:/docs',
        addedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('resolves a folder by the discovered path when its id changed', () => {
    const config = {
      folders: [
        { id: 'new-id', label: 'Docs', path: 'D:/Docs', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'other', label: 'Other', path: 'D:/Other', addedAt: '2026-01-01T00:00:00.000Z' },
      ],
    };

    expect(findLocalFolder(config, 'old-id', 'd:/docs')?.id).toBe('new-id');
  });

  it('keeps POSIX folder paths case-sensitive', () => {
    const config = {
      folders: [
        { id: 'upper', label: 'Docs', path: '/data/Docs', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'lower', label: 'docs', path: '/data/docs', addedAt: '2026-01-01T00:00:00.000Z' },
      ],
    };

    expect(findLocalFolder(config, 'old-id', '/data/docs')?.id).toBe('lower');
  });

  it('does not replace an explicit unknown folder with the only connected folder', () => {
    const config = {
      folders: [{ id: 'known', label: 'Docs', path: 'D:/Docs', addedAt: '2026-01-01T00:00:00.000Z' }],
    };

    expect(findLocalFolder(config, 'missing-id')).toBeUndefined();
  });
});
