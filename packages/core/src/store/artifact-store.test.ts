import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

  it('treats corrupt json sidecars as missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);
    writeFileSync(join(root, 'doc_1.json'), '{not valid json');
    writeFileSync(join(root, 'doc_1.document.json'), '{not valid json');
    writeFileSync(join(root, 'doc_1.ingest.json'), '{not valid json');

    expect(store.getJson('doc_1')).toBeUndefined();
    expect(store.getDocumentArtifact('doc_1')).toBeUndefined();
    expect(store.getIngestResult('doc_1')).toBeUndefined();
  });

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
