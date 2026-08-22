import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildConnectedResourcesFromConnections,
  buildLocalFolderResources,
  formatConnectedResourcesForPrompt,
} from '../../resources/connected-resources.js';
import { inferWorkflowBindings } from '../../../workflow/bindings.js';
import { validateWorkflowContracts } from '../../../workflow/contract-validator.js';

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
    expect(text).toContain('document.ingest params.file');
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

  it('does not scan folders from a disconnected persisted connection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ax-folder-'));
    writeFileSync(join(dir, 'private.pdf'), 'private');

    const snapshot = buildConnectedResourcesFromConnections([
      {
        connector: 'local_folder',
        connected: false,
        config: {
          folders: [{ id: 'f1', label: 'Disconnected', path: dir, addedAt: '2026-01-01T00:00:00.000Z' }],
        },
      },
    ]);

    expect(snapshot.localFolders).toEqual([]);
    expect(formatConnectedResourcesForPrompt(snapshot)).toContain('연결된 로컬 폴더 없음');
    expect(formatConnectedResourcesForPrompt(snapshot)).not.toContain('private.pdf');
  });
});

describe('resource + bindings compile path', () => {
  it('binds local folder trigger file to document ingest without draft defaults', () => {
    const ir = inferWorkflowBindings({
      id: 'wf',
      name: 'PDF',
      goal: '요약',
      version: 1,
      trigger: { type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] },
      steps: [
        {
          type: 'action',
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: {},
          sideEffect: 'NONE',
        },
      ],
      inputs: ['folderId', 'filePath'],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    });

    expect(ir.steps[0]?.type === 'action' && ir.steps[0].bindings).toEqual({
      source: { from: 'trigger', output: 'file' },
    });
    expect(validateWorkflowContracts(ir)).toEqual([]);
  });
});
