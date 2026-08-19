import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildConnectedResourcesFromConnections,
  buildLocalFolderResources,
  formatConnectedResourcesForPrompt,
} from './connected-resources.js';
import { resolveInterviewDraftDefaults } from './draft-defaults.js';

describe('connected-resources', () => {
  it('formats connected folders and files for the interview prompt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-folder-'));
    writeFileSync(join(dir, 'report.pdf'), 'pdf');

    const snapshot = buildLocalFolderResources([
      { id: 'folder-1', label: 'Inbox', path: dir, addedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const text = formatConnectedResourcesForPrompt({ localFolders: snapshot });
    expect(text).toContain('folderId=folder-1');
    expect(text).toContain('report.pdf');
    expect(text).toContain(dir);
  });

  it('builds snapshot from store connections', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-folder-'));
    writeFileSync(join(dir, 'a.txt'), 'hello');

    const snapshot = buildConnectedResourcesFromConnections([
      {
        connector: 'local_folder',
        connected: true,
        config: {
          folders: [{ id: 'f1', label: 'Docs', path: dir, addedAt: '2026-01-01T00:00:00.000Z' }],
        },
      },
    ]);

    expect(snapshot.localFolders).toHaveLength(1);
    expect(snapshot.localFolders[0]?.files[0]?.fileName).toBe('a.txt');
  });
});

describe('draft-defaults', () => {
  it('uses the only pdf path for manual one-shot ingest', () => {
    const draft = resolveInterviewDraftDefaults(
      {
        name: 'PDF 요약',
        goal: '요약',
        triggerType: 'manual',
        assumptions: [],
        nodes: [
          {
            type: 'action',
            id: 'ingest',
            connector: 'document',
            action: 'ingest',
            params: {},
          },
        ],
      },
      {
        localFolders: [
          {
            id: 'folder-1',
            label: 'Inbox',
            path: 'C:/inbox',
            files: [
              {
                filePath: 'C:/inbox/report.pdf',
                fileName: 'report.pdf',
                extension: '.pdf',
              },
            ],
            totalFileCount: 1,
            truncated: false,
          },
        ],
      },
    );

    expect(draft.nodes[0]?.params?.path).toBe('C:/inbox/report.pdf');
  });

  it('fills folderId and trigger placeholder when watching for new files', () => {
    const draft = resolveInterviewDraftDefaults(
      {
        name: 'PDF 요약',
        goal: '새 PDF가 올라오면 요약',
        triggerType: 'local_folder.new_file',
        assumptions: [],
        nodes: [
          {
            type: 'action',
            id: 'ingest',
            connector: 'document',
            action: 'ingest',
            params: {},
          },
        ],
      },
      {
        localFolders: [
          {
            id: 'folder-1',
            label: 'Inbox',
            path: 'C:/inbox',
            files: [],
            totalFileCount: 0,
            truncated: false,
          },
        ],
      },
      { userInstruction: '폴더에 새 PDF가 생기면 요약해줘' },
    );

    expect(draft.localFolderId).toBe('folder-1');
    expect(draft.triggerType).toBe('local_folder.new_file');
    expect(draft.nodes[0]?.params?.path).toBe('{{filePath}}');
  });

  it('bakes concrete path and manual trigger when user refers to an existing pdf', () => {
    const draft = resolveInterviewDraftDefaults(
      {
        name: 'PDF 요약',
        goal: 'PDF 요약 후 Slack 전송',
        triggerType: 'local_folder.new_file',
        assumptions: [],
        nodes: [
          {
            type: 'action',
            id: 'ingest',
            connector: 'document',
            action: 'ingest',
            params: { path: '{{filePath}}' },
          },
        ],
      },
      {
        localFolders: [
          {
            id: 'folder-1',
            label: 'Inbox',
            path: 'C:/inbox',
            files: [
              {
                filePath: 'C:/inbox/report.pdf',
                fileName: 'report.pdf',
                extension: '.pdf',
              },
            ],
            totalFileCount: 1,
            truncated: false,
          },
        ],
      },
      { userInstruction: '연결된 폴더에 pdf 1개 있는데 그거 요약해서 slack으로 보내줘' },
    );

    expect(draft.triggerType).toBe('manual');
    expect(draft.nodes[0]?.params?.path).toBe('C:/inbox/report.pdf');
  });
});
