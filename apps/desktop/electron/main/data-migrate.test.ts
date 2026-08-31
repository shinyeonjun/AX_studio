import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAxDataPaths } from '@ax-studio/core';
import { migrateAxDataIfNeeded } from './data-migrate.js';

vi.mock('electron', () => ({
  app: { getPath: () => process.env.AX_TEST_LEGACY_USER_DATA ?? tmpdir() },
}));

describe('migrateAxDataIfNeeded', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
    delete process.env.AX_TEST_LEGACY_USER_DATA;
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

  it('resumes a partial directory migration without overwriting existing files', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-data-migrate-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    const legacyUserData = join(root, 'legacy-user-data');
    process.env.AX_TEST_LEGACY_USER_DATA = legacyUserData;
    const legacyCredentials = join(legacyUserData, 'credentials');
    mkdirSync(legacyCredentials, { recursive: true });
    mkdirSync(paths.credentials, { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(join(legacyCredentials, 'existing.secret'), 'legacy', 'utf8');
    writeFileSync(join(legacyCredentials, 'missing.secret'), 'missing', 'utf8');
    writeFileSync(join(paths.credentials, 'existing.secret'), 'current', 'utf8');

    migrateAxDataIfNeeded(paths);

    expect(readFileSync(join(paths.credentials, 'existing.secret'), 'utf8')).toBe('current');
    expect(readFileSync(join(paths.credentials, 'missing.secret'), 'utf8')).toBe('missing');
    expect(existsSync(paths.migration)).toBe(true);
  });
});
