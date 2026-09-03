import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { buildManualRunInput } from '../../manual-run-input.js';
import { folderWorkflow } from '../fixtures.js';

describe('buildManualRunInput extension guard', () => {
  it('does not select a file with a different extension than the trigger allows', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-extension-'));
    writeFileSync(join(folderPath, 'notes.txt'), 'not a PDF');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Test', path: folderPath }],
    });

    const input = await buildManualRunInput(
      folderWorkflow({ type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] }),
      store,
    );
    expect(input).toEqual({});
  });
});
