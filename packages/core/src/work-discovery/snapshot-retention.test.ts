import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sweepOrphanSnapshotDirs } from './snapshot-retention.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('snapshot folders of discoveries that are gone', () => {
  it('are removed; folders of live discoveries and loose files are kept', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-snapshots-'));
    roots.push(root);
    for (const id of ['live', 'gone']) {
      mkdirSync(join(root, id, 'ex1'), { recursive: true });
      writeFileSync(join(root, id, 'ex1', 'table.json'), '{}');
    }
    writeFileSync(join(root, 'README'), 'x');

    expect(sweepOrphanSnapshotDirs(root, new Set(['live']))).toBe(1);
    expect(existsSync(join(root, 'live', 'ex1', 'table.json'))).toBe(true);
    expect(existsSync(join(root, 'gone'))).toBe(false);
    expect(existsSync(join(root, 'README'))).toBe(true);
  });

  it('does nothing when the snapshot folder does not exist yet', () => {
    expect(sweepOrphanSnapshotDirs(join(tmpdir(), 'ax-no-such-dir-xyz'), new Set())).toBe(0);
  });
});
