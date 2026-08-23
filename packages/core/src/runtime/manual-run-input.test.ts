import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import {
  buildManualRunInput,
  enrichManualRunInput,
  validateManualRunInput,
  workflowNeedsFilePath,
  workflowNeedsGmailMessageId,
} from './manual-run-input.js';
import type { Connector, ConnectorResult } from '../modules/types.js';
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
    const input = await buildManualRunInput(ir, store);
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
    const input = await buildManualRunInput(ir, store);
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
    const input = await buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
  });

  it('still supplies a folder file when ingest path is already concrete', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-'));
    const pdfPath = join(folderPath, 'sample.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Test', path: folderPath }],
    });

    const ir = folderWorkflow({ type: 'manual' });
    ir.steps[0] = {
      ...ir.steps[0]!,
      params: { path: 'D:\\not-connected\\invented.pdf' },
    };
    const input = await buildManualRunInput(ir, store);
    expect(input.filePath).toBe(pdfPath);
  });

  it('does not guess when multiple connected folders contain matching files', async () => {
    const firstFolder = mkdtempSync(join(tmpdir(), 'ax-manual-run-first-'));
    const secondFolder = mkdtempSync(join(tmpdir(), 'ax-manual-run-second-'));
    writeFileSync(join(firstFolder, 'first.pdf'), '%PDF-1.4 mock');
    writeFileSync(join(secondFolder, 'second.pdf'), '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [
        { id: 'folder-1', label: 'First', path: firstFolder },
        { id: 'folder-2', label: 'Second', path: secondFolder },
      ],
    });

    const input = await buildManualRunInput(folderWorkflow({ type: 'manual' }), store);
    expect(input).toEqual({});
  });

  it('does not switch folders when an explicitly selected folder is empty', async () => {
    const emptyFolder = mkdtempSync(join(tmpdir(), 'ax-manual-run-empty-'));
    const otherFolder = mkdtempSync(join(tmpdir(), 'ax-manual-run-other-'));
    writeFileSync(join(otherFolder, 'other.pdf'), '%PDF-1.4 mock');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [
        { id: 'folder-empty', label: 'Empty', path: emptyFolder },
        { id: 'folder-other', label: 'Other', path: otherFolder },
      ],
    });

    const input = await buildManualRunInput(
      folderWorkflow({ type: 'local_folder.new_file', folderId: 'folder-empty', extensions: ['.pdf'] }),
      store,
    );

    expect(input).toEqual({});
  });

  it('does not select a file with a different extension than the trigger allows', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-manual-run-extension-'));
    writeFileSync(join(folderPath, 'notes.txt'), 'not a PDF');

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('local_folder', true, {
      folders: [{ id: 'folder-1', label: 'Test', path: folderPath }],
    });

    const input = await buildManualRunInput(
      folderWorkflow({ type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] }),
      store,
    );
    expect(input).toEqual({});
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

  it('requires messageId for gmail trigger workflows that read mail', () => {
    const ir: WorkflowIR = {
      id: 'wf-gmail',
      name: '네이버 메일 Slack 요약',
      goal: '요약',
      version: 1,
      trigger: { type: 'gmail.new_message', accountId: 'primary' },
      steps: [
        {
          type: 'action',
          id: 'read-mail',
          connector: 'gmail',
          action: 'messages.read',
          params: {},
          sideEffect: 'NONE',
        },
      ],
    };

    expect(workflowNeedsGmailMessageId(ir)).toBe(true);
    expect(validateManualRunInput(ir, {})).toEqual({
      ok: false,
      errorCode: 'manual_run_input_missing',
      message: expect.stringContaining('받은편지함'),
    });
  });
});

describe('enrichManualRunInput', () => {
  it('fills latest inbox message id for gmail trigger manual runs', async () => {
    const ir: WorkflowIR = {
      id: 'wf-gmail',
      name: '네이버 메일 Slack 요약',
      goal: '요약',
      version: 1,
      trigger: { type: 'gmail.new_message', accountId: 'primary' },
      steps: [
        {
          type: 'action',
          id: 'read-mail',
          connector: 'gmail',
          action: 'messages.read',
          params: {},
          sideEffect: 'NONE',
        },
      ],
    };

    const gmail: Connector = {
      name: 'gmail',
      async execute(action, _params, _ctx): Promise<ConnectorResult> {
        if (action === 'messages.search') {
          return { ok: true, data: [{ id: 'latest-msg' }] };
        }
        return { ok: false, error: 'unexpected' };
      },
    };

    const enriched = await enrichManualRunInput(ir, { gmail }, {});
    expect(enriched.messageId).toBe('latest-msg');
    expect(validateManualRunInput(ir, enriched)).toEqual({ ok: true });
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
