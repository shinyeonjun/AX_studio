import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { buildManualRunInput } from '../../manual-run-input.js';
import { folderWorkflow } from '../fixtures.js';

describe('buildManualRunInput path and selection guards', () => {
  it('still supplies a folder file when ingest path is already concrete', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-'));
    const pdfPath = join(folderPath, 'sample.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Test', path: folderPath }],
    });

    const ir = folderWorkflow({ type: 'manual' });
    ir.steps[0] = {
      ...ir.steps[0]!,
      params: { path: 'D:\\not-connected\\invented.pdf' },
    };
    const input = await buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
  });

  it('does not guess when multiple connected folders contain matching files', async () => {
    const firstFolder = mkdtempSync(join(tmpdir(), 'ax-manual-run-first-'));
    const secondFolder = mkdtempSync(join(tmpdir(), 'ax-manual-run-second-'));
    writeFileSync(join(firstFolder, 'first.pdf'), '%PDF-1.4 mock');
    writeFileSync(join(secondFolder, 'second.pdf'), '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [
        { id: 'folder-1', label: 'First', path: firstFolder },
        { id: 'folder-2', label: 'Second', path: secondFolder },
      ],
    });

    const input = await buildManualRunInput(folderWorkflow({ type: 'manual' }), store);
    expect(input).toEqual({});
  });

  it('does not switch folders when an explicitly selected folder is empty', async () => {
    const emptyFolder = mkdtempSync(join(tmpdir(), 'ax-manual-run-empty-'));
    const otherFolder = mkdtempSync(join(tmpdir(), 'ax-manual-run-other-'));
    writeFileSync(join(otherFolder, 'other.pdf'), '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [
        { id: 'folder-empty', label: 'Empty', path: emptyFolder },
        { id: 'folder-other', label: 'Other', path: otherFolder },
      ],
    });

    const input = await buildManualRunInput(
      folderWorkflow({ type: 'local_folder.new_file', folderId: 'folder-empty', extensions: ['.pdf'] }),
      store,
    );

    expect(input).toEqual({});
  });
});
