import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildDesignToolContext, executeDesignToolCalls } from './index.js';

describe('design-tools inventory', () => {
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
    ]);
  });
});
