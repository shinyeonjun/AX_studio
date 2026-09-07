import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildDesignToolContext, executeDesignToolCalls } from '../index.js';
describe('design-tools disconnected source connection', () => {
  it('does not read a configured folder after the connection is disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-disconnected-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');
    const ctx = buildDesignToolContext([{ connector: 'local_folder', connected: false, config: { folders: [{ id: 'folder-1', label: 'Inbox', path: dir }] } }], []);
    const [listed, read] = await executeDesignToolCalls([
      { tool: 'sources.files.list', args: { folderId: 'folder-1', extensions: ['.pdf'] } },
      { tool: 'sources.file.read', args: { folderId: 'folder-1', path: join(dir, 'report.pdf') } },
    ], ctx);
    expect(listed?.ok).toBe(false);
    expect(listed?.error).toBe('local_folder_not_connected');
    expect(read?.ok).toBe(false);
    expect(read?.error).toBe('local_folder_not_connected');
  });
});
