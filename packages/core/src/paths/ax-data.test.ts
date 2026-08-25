import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  AX_DATA_FOLDER_DEV,
  AX_DATA_FOLDER_STABLE,
  buildAxDataPaths,
  getAxDataPaths,
  resolveAxDataPaths,
  resolvePlatformDataRoot,
  setAxDataPaths,
} from './ax-data.js';

describe('AxDataPaths', () => {
  it('builds layout under root', () => {
    const root = join('AXStudio');
    const paths = buildAxDataPaths(root);
    expect(paths.database).toBe(join(root, 'data', 'ax-studio.db'));
    expect(paths.documents).toBe(join(root, 'documents'));
    expect(paths.artifacts).toBe(join(root, 'artifacts'));
    expect(paths.sessions).toBe(join(root, 'sessions'));
    expect(paths.templates).toBe(join(root, 'templates'));
    expect(paths.generated.reports).toBe(join(root, 'generated', 'reports'));
    expect(paths.cache.chromium).toBe(join(root, 'cache', 'chromium'));
    expect(paths.migration).toBe(join(root, 'config', 'migration.json'));
    expect(paths.logs).toBe(join(root, 'logs'));
  });

  it('prefers explicit dataRoot over env', () => {
    const prev = process.env.AX_DATA_ROOT;
    process.env.AX_DATA_ROOT = '/env/root';
    try {
      const paths = resolveAxDataPaths({ dataRoot: '/explicit/root' });
      expect(paths.root).toBe('/explicit/root');
    } finally {
      if (prev === undefined) delete process.env.AX_DATA_ROOT;
      else process.env.AX_DATA_ROOT = prev;
    }
  });

  it('setAxDataPaths overrides defaults', () => {
    const custom = buildAxDataPaths('/custom');
    setAxDataPaths(custom);
    expect(getAxDataPaths().root).toBe('/custom');
    setAxDataPaths(null);
  });

  it('keeps stable and dev platform roots on separate folders', () => {
    const stable = resolvePlatformDataRoot(AX_DATA_FOLDER_STABLE);
    const dev = resolvePlatformDataRoot(AX_DATA_FOLDER_DEV);
    expect(stable.endsWith(AX_DATA_FOLDER_STABLE) || stable.endsWith(`/${AX_DATA_FOLDER_STABLE}`)).toBe(true);
    expect(dev).not.toBe(stable);
    expect(dev.includes(AX_DATA_FOLDER_DEV)).toBe(true);
  });
});
