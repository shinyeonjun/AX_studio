import { describe, expect, it } from 'vitest';
import {
  buildAxDataPaths,
  getAxDataPaths,
  resolveAxDataPaths,
  setAxDataPaths,
} from './ax-data.js';

describe('AxDataPaths', () => {
  it('builds layout under root', () => {
    const paths = buildAxDataPaths('C:\\AXStudio');
    expect(paths.database).toBe('C:\\AXStudio\\data\\ax-studio.db');
    expect(paths.documents).toBe('C:\\AXStudio\\documents');
    expect(paths.templates).toBe('C:\\AXStudio\\templates');
    expect(paths.generated.reports).toBe('C:\\AXStudio\\generated\\reports');
    expect(paths.cache.chromium).toBe('C:\\AXStudio\\cache\\chromium');
    expect(paths.migration).toBe('C:\\AXStudio\\config\\migration.json');
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
});
