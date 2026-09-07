import { describe, expect, it } from 'vitest';
import { findLocalFolder, upsertLocalFolder } from './connection.js';

describe('local-folder path identity and matching', () => {
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
