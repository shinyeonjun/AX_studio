import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../artifact-store.js';

describe('ArtifactStore metadata and JSON', () => {
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

  it('builds the dedup index from metadata files only, never from sidecars', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const first = new ArtifactStore(root);
    const source = join(root, 'sample.txt');
    writeFileSync(source, 'fixture content');
    const imported = first.importFile(source);
    // A sidecar that happens to look like artifact metadata must not be indexed.
    first.putDocumentArtifact('doc_x', { ...imported, id: 'doc_x', sha256: 'f'.repeat(64) });

    const reopened = new ArtifactStore(root);
    expect(reopened.findBySha('f'.repeat(64))).toBeUndefined();
    expect(reopened.findBySha(imported.sha256)).toEqual(imported);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('sanitizes and bounds imported file names but keeps the extension', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);
    // 80 Hangul = 240 bytes: a legal Linux name (255-byte limit) that still exceeds the byte cap.
    const longName = `${'가'.repeat(80)}.pdf`;
    const source = join(root, longName);
    writeFileSync(source, '%PDF long name');

    const imported = store.importFile(source);
    expect(Buffer.byteLength(imported.fileName, 'utf8')).toBeLessThanOrEqual(180);
    expect(Array.from(imported.fileName).length).toBeLessThanOrEqual(120);
    expect(imported.fileName.endsWith('.pdf')).toBe(true);
    expect(store.get(imported.id)).toEqual(imported);
  });
});
