import { describe, expect, it } from 'vitest';
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
    const paths = buildAxDataPaths('C:\\AXStudio');
    expect(paths.database).toBe('C:\\AXStudio\\data\\ax-studio.db');
    expect(paths.documents).toBe('C:\\AXStudio\\documents');
    expect(paths.artifacts).toBe('C:\\AXStudio\\artifacts');
    expect(paths.sessions).toBe('C:\\AXStudio\\sessions');
    expect(paths.templates).toBe('C:\\AXStudio\\templates');
    expect(paths.generated.reports).toBe('C:\\AXStudio\\generated\\reports');
    expect(paths.cache.chromium).toBe('C:\\AXStudio\\cache\\chromium');
    expect(paths.migration).toBe('C:\\AXStudio\\config\\migration.json');
    expect(paths.logs).toBe('C:\\AXStudio\\logs');
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
