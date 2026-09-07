import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildContext } from './fixtures.js';
import { localSheetDiscoverySource } from '../discovery-source.js';

describe('local sheet discovery unavailable inputs', () => {
  it('skips inaccessible folders and treats corrupt workbooks as unprofileable sources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sheet-discovery-'));
    const missing = join(root, 'missing');
    const corruptPath = join(root, 'broken.xlsx');
    writeFileSync(corruptPath, Buffer.alloc(0));
    const { context, store } = await buildContext(root);
    store.setConnection('local_folder', true, {
      folders: [
        { id: 'reports', label: 'Reports', path: root, addedAt: new Date(0).toISOString() },
        { id: 'missing', label: 'Missing', path: missing, addedAt: new Date(0).toISOString() },
      ],
    });

    const sources = await localSheetDiscoverySource.listSources(context);
    const corruptSource = sources.find((source) => source.metadata?.path === corruptPath);

    expect(sources).toHaveLength(1);
    expect(corruptSource).toBeTruthy();
    await expect(localSheetDiscoverySource.profileSource(context, corruptSource!.id)).resolves.toBeNull();
  });
});
