import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { buildManualRunInput } from '../../manual-run-input.js';
import { folderWorkflow } from '../fixtures.js';

describe('buildManualRunInput single-folder resolution', () => {
  it('fills local folder filePath for manual runs', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-'));
    const pdfPath = join(folderPath, 'sample.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Test', path: folderPath }],
    });

    const ir = folderWorkflow({ type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] });
    const input = await buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
    expect(input.fileRef).toMatchObject({ path: pdfPath, name: 'sample.pdf' });
  });

  it('falls back when trigger folderId is stale but a single folder is connected', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-'));
    const pdfPath = join(folderPath, 'sample.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-new', label: 'Test', path: folderPath }],
    });

    const ir = folderWorkflow({ type: 'local_folder.new_file', folderId: 'folder-old', extensions: ['.pdf'] });
    const input = await buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
  });

  it('fills filePath for manual trigger workflows that ingest documents', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-'));
    const pdfPath = join(folderPath, 'sample.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Test', path: folderPath }],
    });

    const ir = folderWorkflow({ type: 'manual' });
    const input = await buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
  });
});
