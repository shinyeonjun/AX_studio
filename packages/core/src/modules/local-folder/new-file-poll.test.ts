import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConnectorContext } from '../types.js';
import type { LocalFolderConnectionConfig } from './connection.js';
import { newFilePoll, type NewFilePollParams } from './new-file-poll.js';

describe('newFilePoll', () => {
  it('detects a file recreated at a previously deleted path', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-new-file-poll-'));
    const filePath = join(folderPath, 'report.pdf');
    const config: LocalFolderConnectionConfig = {
      folders: [{ id: 'folder-1', label: 'Reports', path: folderPath, addedAt: new Date(0).toISOString() }],
    };
    const ctx: ConnectorContext = {
      executionId: 'execution-1',
      variables: {},
      log: () => {},
    };

    const poll = async (params: NewFilePollParams) => newFilePoll(config, params, ctx);

    writeFileSync(filePath, 'first');
    const baseline = await poll({ folderId: 'folder-1' });
    const baselineCursor = (baseline.data as { cursor: NewFilePollParams }).cursor;

    unlinkSync(filePath);
    const afterDelete = await poll(baselineCursor);
    const afterDeleteCursor = (afterDelete.data as { cursor: NewFilePollParams }).cursor;
    expect(afterDeleteCursor.seenFileKeys).toEqual([]);

    writeFileSync(filePath, 'second');
    const afterRecreate = await poll(afterDeleteCursor);
    expect(afterRecreate.data).toMatchObject({
      events: [{ payload: { filePath } }],
    });
  });
});
