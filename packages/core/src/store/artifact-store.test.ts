import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from './artifact-store.js';

describe('ArtifactStore', () => {
  it('deduplicates imports by sha256', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);
    const source = join(root, 'sample.txt');
    writeFileSync(source, 'fixture content');

    const first = store.importFile(source);
    const second = store.importFile(source);
    expect(second.id).toBe(first.id);
    expect(second.sha256).toBe(first.sha256);
  });

  it('ignores corrupt and unrelated metadata while importing files', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);
    const source = join(root, 'sample.txt');
    writeFileSync(source, 'fixture content');
    writeFileSync(join(root, 'corrupt.json'), '{not valid json');
    writeFileSync(join(root, 'unrelated.json'), JSON.stringify({ status: 'partial' }));

    const imported = store.importFile(source);

    expect(imported.fileName).toBe('sample.txt');
    expect(store.get(imported.id)).toEqual(imported);
  });

  it('stores and retrieves json artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);
    store.putJson('doc_1', { id: 'doc_1', text: '총매출: 12.4억' });
    expect(store.getJson('doc_1')).toEqual({ id: 'doc_1', text: '총매출: 12.4억' });
  });
});
