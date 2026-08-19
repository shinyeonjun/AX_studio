import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import {
  buildManualRunInput,
  validateManualRunInput,
  workflowNeedsFilePath,
} from './manual-run-input.js';
import { resolveStepParams } from './ai-investigation.js';
import type { ConnectorContext } from '../modules/types.js';
import type { WorkflowIR } from '../workflow/schema.js';

function folderWorkflow(trigger?: WorkflowIR['trigger']): WorkflowIR {
  return {
    id: 'wf-1',
    name: 'PDF 요약',
    goal: '요약',
    version: 1,
    trigger,
    steps: [
      {
        type: 'action',
        id: 'ingest',
        connector: 'document',
        action: 'ingest',
        params: { path: '{{filePath}}' },
        sideEffect: 'NONE',
      },
    ],
  };
}

describe('buildManualRunInput', () => {
  it('fills local folder filePath for manual runs', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-'));
    const pdfPath = join(folderPath, 'sample.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Test', path: folderPath }],
    });

    const ir = folderWorkflow({ type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] });
    const input = buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
    expect(input.fileRef).toMatchObject({ path: pdfPath, name: 'sample.pdf' });
  });

  it('falls back when trigger folderId is stale but a single folder is connected', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-'));
    const pdfPath = join(folderPath, 'sample.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-new', label: 'Test', path: folderPath }],
    });

    const ir = folderWorkflow({ type: 'local_folder.new_file', folderId: 'folder-old', extensions: ['.pdf'] });
    const input = buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
  });

  it('fills filePath for manual trigger workflows that ingest documents', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-'));
    const pdfPath = join(folderPath, 'sample.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Test', path: folderPath }],
    });

    const ir = folderWorkflow({ type: 'manual' });
    const input = buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
  });
});

describe('validateManualRunInput', () => {
  it('requires filePath when document ingest uses trigger placeholders', () => {
    const ir = folderWorkflow({ type: 'manual' });
    expect(workflowNeedsFilePath(ir)).toBe(true);
    expect(validateManualRunInput(ir, {})).toEqual({
      ok: false,
      errorCode: 'manual_run_input_missing',
      message: expect.stringContaining('연결된 폴더'),
    });
  });
});

describe('resolveStepParams templates', () => {
  it('resolves bare filePath from execution variables', () => {
    const ctx: ConnectorContext = {
      executionId: 'exec-1',
      variables: { filePath: 'D:\\docs\\sample.pdf' },
      log: () => {},
    };
    const resolved = resolveStepParams({ path: '{{filePath}}' }, ctx, {});
    expect(resolved.path).toBe('D:\\docs\\sample.pdf');
  });
});
