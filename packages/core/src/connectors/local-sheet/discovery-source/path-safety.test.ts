import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildContext } from './fixtures.js';
import { localSheetDiscoverySource } from '../discovery-source.js';

describe('local sheet discovery path safety', () => {
  it('rejects source IDs that point outside the connected folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sheet-discovery-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-sheet-outside-'));
    const outsidePath = join(outside, 'secret.csv');
    writeFileSync(outsidePath, 'secret\nvalue\n');
    const { context } = await buildContext(root);
    const sourceId = `sheet:${encodeURIComponent('reports')}:${encodeURIComponent(outsidePath)}`;

    await expect(localSheetDiscoverySource.profileSource(context, sourceId)).resolves.toBeNull();
  });
});
