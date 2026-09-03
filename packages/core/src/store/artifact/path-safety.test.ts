import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../artifact-store.js';

describe('ArtifactStore path safety', () => {
  it('rejects artifact IDs that can escape the store root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'ax-artifacts-parent-'));
    const root = join(parent, 'artifacts');
    const store = new ArtifactStore(root);
    const source = join(parent, 'sample.txt');
    writeFileSync(source, 'fixture content');

    expect(() => store.importFile(source, { id: '../escaped' })).toThrow('Invalid artifact id');
    expect(() => store.putJson('../escaped', { unsafe: true })).toThrow('Invalid artifact id');
    expect(() => store.putDocumentArtifact('nested/escaped', { unsafe: true })).toThrow('Invalid artifact id');
    expect(() => store.putIngestResult('nested\\escaped', { unsafe: true })).toThrow('Invalid artifact id');
    expect(() => store.getJson('../escaped')).toThrow('Invalid artifact id');
    expect(() => store.getDocumentArtifact('../escaped')).toThrow('Invalid artifact id');
    expect(() => store.getIngestResult('../escaped')).toThrow('Invalid artifact id');
    expect(() => store.get('../escaped')).toThrow('Invalid artifact id');
    expect(() => store.remove('../escaped')).toThrow('Invalid artifact id');
    expect(existsSync(join(parent, 'escaped.json'))).toBe(false);
  });

  it('ignores metadata whose stored file is outside the store root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'ax-artifacts-parent-'));
    const root = join(parent, 'artifacts');
    mkdirSync(root);
    const outside = join(parent, 'outside.txt');
    writeFileSync(outside, 'keep me');
    writeFileSync(
      join(root, 'forged.json'),
      JSON.stringify({
        id: 'forged',
        sha256: 'forged-sha',
        fileName: 'outside.txt',
        storedPath: outside,
        size: 7,
        createdAt: new Date().toISOString(),
      }),
    );
    const store = new ArtifactStore(root);

    expect(store.get('forged')).toBeUndefined();
    expect(store.findBySha('forged-sha')).toBeUndefined();
    store.remove('forged');
    expect(existsSync(outside)).toBe(true);
  });
});
