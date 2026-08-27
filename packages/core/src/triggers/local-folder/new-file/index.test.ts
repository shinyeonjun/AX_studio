import { describe, expect, it, vi } from 'vitest';
import type { Connector } from '../../../modules/types.js';
import { localFolderNewFileHandler } from './index.js';

function connectorReturning(cursor: Record<string, unknown>): Connector {
  return {
    name: 'local_folder',
    execute: vi.fn().mockResolvedValue({ ok: true, data: { events: [], cursor } }),
  };
}

describe('localFolderNewFileHandler', () => {
  it('re-baselines when the folder trigger configuration changes', async () => {
    const connector = connectorReturning({ initialized: true, folderId: 'inbox', seenFileKeys: ['old.pdf'] });

    const first = await localFolderNewFileHandler.poll!({
      workflowId: 'workflow-1',
      trigger: { type: 'local_folder.new_file', folderId: 'inbox', extensions: ['pdf'] },
      cursor: { initialized: true, folderId: 'inbox', seenFileKeys: ['old.pdf'] },
      connectors: { local_folder: connector },
    });
    await localFolderNewFileHandler.poll!({
      workflowId: 'workflow-1',
      trigger: { type: 'local_folder.new_file', folderId: 'inbox', extensions: ['txt'] },
      cursor: first.cursor,
      connectors: { local_folder: connector },
    });

    expect(connector.execute).toHaveBeenLastCalledWith(
      'new_file.poll',
      expect.objectContaining({ initialized: false, seenFileKeys: [], extensions: ['txt'] }),
      expect.any(Object),
    );
  });

  it('keeps the cursor when equivalent extension filters are reordered', async () => {
    const connector = connectorReturning({ initialized: true, folderId: 'inbox', seenFileKeys: ['old.pdf'] });

    const first = await localFolderNewFileHandler.poll!({
      workflowId: 'workflow-1',
      trigger: { type: 'local_folder.new_file', folderId: 'inbox', extensions: ['PDF', '.txt'] },
      cursor: {},
      connectors: { local_folder: connector },
    });
    await localFolderNewFileHandler.poll!({
      workflowId: 'workflow-1',
      trigger: { type: 'local_folder.new_file', folderId: 'inbox', extensions: ['txt', '.pdf'] },
      cursor: first.cursor,
      connectors: { local_folder: connector },
    });

    expect(connector.execute).toHaveBeenLastCalledWith(
      'new_file.poll',
      expect.objectContaining({ initialized: true, seenFileKeys: ['old.pdf'] }),
      expect.any(Object),
    );
  });

  it('re-baselines when the bound folder path changes', async () => {
    const connector = connectorReturning({ initialized: true, folderId: 'inbox', seenFileKeys: ['old.pdf'] });

    const first = await localFolderNewFileHandler.poll!({
      workflowId: 'workflow-1',
      trigger: { type: 'local_folder.new_file', folderId: 'inbox', folderPath: '/old/inbox' },
      cursor: {},
      connectors: { local_folder: connector },
    });
    await localFolderNewFileHandler.poll!({
      workflowId: 'workflow-1',
      trigger: { type: 'local_folder.new_file', folderId: 'inbox', folderPath: '/new/inbox' },
      cursor: first.cursor,
      connectors: { local_folder: connector },
    });

    expect(connector.execute).toHaveBeenLastCalledWith(
      'new_file.poll',
      expect.objectContaining({ initialized: false, seenFileKeys: [], folderPath: '/new/inbox' }),
      expect.any(Object),
    );
  });
});
