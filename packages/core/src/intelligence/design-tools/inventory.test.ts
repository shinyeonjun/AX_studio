import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildDesignToolContext, executeDesignToolCalls } from './index.js';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';
import { AxCommandService } from '../agent/commands/service.js';

describe('design-tools inventory', () => {
  it('pages connected folders without dumping all folder metadata', async () => {
    const ctx = buildDesignToolContext([{ connector: 'local_folder', connected: true, config: {
      folders: Array.from({ length: 57 }, (_, i) => ({ id: `folder-${i}`, label: `Folder ${i}`, path: tmpdir() })),
    } }], ['local_folder']);
    const [first, last] = await executeDesignToolCalls([
      { tool: 'sources.list', args: { connector: 'local_folder' } },
      { tool: 'sources.list', args: { connector: 'local_folder', offset: 40 } },
    ], ctx);
    expect(first?.data).toMatchObject({ totalSources: 57, nextOffset: 20, truncated: true });
    expect(last?.data).toMatchObject({ sources: expect.arrayContaining([expect.objectContaining({ id: 'folder-56' })]), truncated: false });
  });

  it('keeps later files reachable through the public source command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-file-pages-'));
    const db = await createDatabaseAsync(':memory:');
    try {
      for (let i = 0; i < 57; i++) writeFileSync(join(dir, `item-${String(i).padStart(2, '0')}.pdf`), 'fixture');
      const ctx = buildDesignToolContext([{ connector: 'local_folder', connected: true, config: {
        folders: [{ id: 'files', label: 'Files', path: dir }],
      } }], ['local_folder']);
      const service = new AxCommandService(new WorkflowStore(db));
      const first = await service.execute({ name: 'source.files.list', args: { folderId: 'files' } }, { designToolContext: ctx });
      expect(first.status).toBe('ok');
      expect(first.data).toMatchObject({ nextOffset: 20, totalFileCount: 57, totalFileCountIsExact: true });
      const last = await service.execute({ name: 'source.files.list', args: { folderId: 'files', offset: 40, limit: 20 } }, { designToolContext: ctx });
      expect(last.data).toMatchObject({ offset: 40, hasMore: false, files: expect.arrayContaining([
        expect.objectContaining({ fileName: 'item-56.pdf' }),
      ]) });
    } finally { db.close?.(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('lists connections and local folder files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-design-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');

    const ctx = buildDesignToolContext(
      [
        {
          connector: 'local_folder',
          connected: true,
          config: {
            folders: [{ id: 'folder-1', label: 'Inbox', path: dir, addedAt: '2026-01-01T00:00:00.000Z' }],
          },
        },
        { connector: 'slack', connected: true, config: { token: 'xoxb-test' } },
      ],
      ['slack', 'local_folder', 'document'],
    );

    const results = await executeDesignToolCalls(
      [
        { tool: 'connections.list' },
        { tool: 'sources.list', args: { connector: 'local_folder' } },
        { tool: 'sources.files.list', args: { folderId: 'folder-1', extensions: ['.pdf'] } },
      ],
      ctx,
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(JSON.stringify(results[0]?.data)).toContain('local_folder');
    expect(JSON.stringify(results[2]?.data)).toContain('report.pdf');
  });

  it('lists available design tools via tools.list', async () => {
    const ctx = buildDesignToolContext([], ['document']);
    const results = await executeDesignToolCalls([{ tool: 'tools.list' }], ctx);

    expect(results[0]?.ok).toBe(true);
    const tools = results[0]?.data as Array<{ id: string }>;
    expect(tools.map((entry) => entry.id)).toEqual([
      'tools.list',
      'connections.list',
      'sources.list',
      'sources.files.list',
      'sources.file.read',
      'sources.search',
      'capabilities.list',
      'capabilities.describe',
      'capabilities.invoke',
      'discovery.search',
      'discovery.describe',
    ]);
  });
});
