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

  it('validates typed sidecars on write and read', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);

    expect(() => store.putDocumentArtifact('doc_1', { id: 'doc_1', text: 42 })).toThrow('invalid_document_artifact');
    expect(() => store.putIngestResult('doc_1', { documentId: 'doc_1' })).toThrow('invalid_ingest_result');

    writeFileSync(join(root, 'doc_1.document.json'), JSON.stringify({ id: 'doc_1', text: 42 }));
    writeFileSync(join(root, 'doc_1.ingest.json'), JSON.stringify({ documentId: 'doc_1' }));

    expect(store.getDocumentArtifact('doc_1')).toBeUndefined();
    expect(store.getIngestResult('doc_1')).toBeUndefined();
  });

  it('keeps typed workbook and table sidecars separate from generic JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);
    const table = {
      id: 'table_1',
      kind: 'table' as const,
      columns: [{ name: 'total', type: 'number' as const, nullable: true, inferred: false }],
      rows: [{ index: 0, values: { total: 300 } }],
      truncated: false,
    };
    const workbook = {
      id: 'workbook_1',
      kind: 'workbook' as const,
      file: { path: 'C:/fixtures/report.csv', name: 'report.csv' },
      sheets: [{
        name: 'Sheet1',
        index: 0,
        visibility: 'visible' as const,
        tables: [{ id: 'table_1', artifactId: 'table_1' }],
        formulaCount: 0,
        imageCount: 0,
        chartCount: 0,
      }],
      namedRanges: [],
    };

    store.putTableArtifact(table.id, table);
    store.putWorkbookArtifact(workbook.id, workbook);

    expect(store.getTableArtifact(table.id)).toEqual(table);
    expect(store.getWorkbookArtifact(workbook.id)).toEqual(workbook);
    expect(store.getJson('workbook_1')).toEqual(workbook);
  });

  it('rejects filename-escaping artifact ids before filesystem access', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);

    expect(() => store.putJson('bad/id', { ok: true })).toThrow('invalid_artifact_id');
    expect(store.getJson('bad/id')).toBeUndefined();
  });

  it('ignores metadata whose stored file path escapes the artifact root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifacts-'));
    const store = new ArtifactStore(root);
    writeFileSync(join(root, 'art_bad.json'), JSON.stringify({
      id: 'art_bad',
      sha256: 'a'.repeat(64),
      fileName: 'report.txt',
      storedPath: join(root, '..', 'report.txt'),
      size: 1,
      createdAt: new Date().toISOString(),
    }));

    expect(store.get('art_bad')).toBeUndefined();
    expect(store.findBySha('a'.repeat(64))).toBeUndefined();
  });
});
