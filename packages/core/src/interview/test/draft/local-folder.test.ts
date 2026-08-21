import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildLocalFolderResources } from '../../resources/connected-resources.js';
import {
  buildInterviewSessionHints,
  normalizeLocalFolderDraft,
} from '../../draft/local-folder.js';

function folderResources() {
  const dir = mkdtempSync(join(tmpdir(), 'ax-local-folder-'));
  writeFileSync(join(dir, 'report.pdf'), 'pdf');
  return buildLocalFolderResources([
    { id: 'folder-1', label: 'Inbox', path: dir, addedAt: '2026-01-01T00:00:00.000Z' },
  ]);
}

describe('local-folder-draft', () => {
  it('stores a verified FileRef for manual ingest', () => {
    const resources = { localFolders: folderResources() };
    const pdfPath = resources.localFolders[0]!.files[0]!.filePath;

    const draft = normalizeLocalFolderDraft(
      {
        name: 'PDF',
        goal: 'PDF 요약',
        triggerType: 'manual',
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
      resources,
    );

    expect(draft.actions.ingest?.params?.path).toBeUndefined();
    expect(draft.actions.ingest?.params?.file).toMatchObject({ path: pdfPath, name: 'report.pdf' });
  });

  it('replaces an invented ingest path with a verified FileRef', () => {
    const resources = { localFolders: folderResources() };
    const pdfPath = resources.localFolders[0]!.files[0]!.filePath;

    const draft = normalizeLocalFolderDraft(
      {
        name: 'PDF',
        goal: 'PDF 요약',
        triggerType: 'manual',
        assumptions: [],
        nodes: [
          {
            type: 'action',
            id: 'ingest',
            connector: 'document',
            action: 'ingest',
            params: { path: 'D:\\somewhere-else\\invented.pdf' },
          },
        ],
      },
      resources,
    );

    expect(draft.actions.ingest?.params?.path).toBeUndefined();
    expect(draft.actions.ingest?.params?.file).toMatchObject({ path: pdfPath, name: 'report.pdf' });
  });

  it('removes static paths from recurring folder ingests', () => {
    const resources = { localFolders: folderResources() };
    const draft = normalizeLocalFolderDraft(
      {
        name: 'PDF',
        goal: '새 PDF 요약',
        triggerType: 'local_folder.new_file',
        localFolderId: 'folder-1',
        assumptions: [],
        nodes: [
          {
            type: 'action',
            id: 'ingest',
            connector: 'document',
            action: 'ingest',
            params: { path: 'D:\\somewhere-else\\invented.pdf' },
          },
        ],
      },
      resources,
    );

    expect(draft.actions.ingest?.params).toEqual({});
  });

  it('defaults local_folder trigger folder and pdf extension', () => {
    const resources = { localFolders: folderResources() };

    const draft = normalizeLocalFolderDraft(
      {
        name: 'PDF',
        goal: '폴더 PDF Slack',
        triggerType: 'local_folder.new_file',
        assumptions: [],
        nodes: [],
      },
      resources,
    );

    expect(draft.localFolderId).toBe('folder-1');
    expect(draft.localFolderPath).toBe(resources.localFolders[0]!.path);
    expect(draft.localFolderExtensions).toBe('.pdf');
  });

  it('builds session hint when user says files already exist', () => {
    const hints = buildInterviewSessionHints(
      [
        { role: 'user', content: '연결된 폴더 pdf slack으로' },
        { role: 'assistant', content: '채널 알려주세요' },
        { role: 'user', content: '#ax테스트' },
        { role: 'assistant', content: 'pdf 추가해주세요' },
        { role: 'user', content: '이미 있어요' },
      ],
      '연결된 폴더 pdf slack으로',
      'once',
    );

    expect(hints).toContain('이미 있다');
    expect(hints).toContain('manual');
  });

  it('does not force a local-folder or manual trigger for unrelated recurring work', () => {
    const hints = buildInterviewSessionHints(
      [{ role: 'user', content: '새 메일이 오면 Slack으로 알려줘' }],
      '새 메일이 오면 Slack으로 알려줘',
      'recurring',
    );

    expect(hints).not.toContain('local_folder.new_file');
    expect(hints).not.toContain('manual');
  });
});
