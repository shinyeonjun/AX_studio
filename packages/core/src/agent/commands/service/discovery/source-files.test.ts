import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
describe('AxCommandService source discovery', () => {
  it('routes source discovery through the existing guarded source handlers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-command-source-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] });
    const service = new AxCommandService(store);
    const listed = await service.execute({ name: 'source.files.list', args: { folderId: 'folder-1', extensions: ['.pdf'] } });
    expect(listed.status).toBe('ok');
    expect(JSON.stringify(listed.data)).toContain('report.pdf');
  });
});
