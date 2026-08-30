import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAxDataPaths } from '@ax-studio/core';
import { migrateAxDataIfNeeded } from './data-migrate.js';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
}));

describe('migrateAxDataIfNeeded', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('reports the migration file when its JSON is malformed', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-data-migrate-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(paths.migration, '{invalid json', 'utf8');

    expect(() => migrateAxDataIfNeeded(paths)).toThrow(
      `AX Studio 저장소 마이그레이션 기록을 읽을 수 없습니다: ${paths.migration}`,
    );
  });
});
