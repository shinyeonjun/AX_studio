import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '../../../../../../packages/core/src/persistence/db.js';
import { WorkflowStore } from '../../../../../../packages/core/src/persistence/workflow-store.js';
import {
  createPreviewApprovalFixture, INVALID_PREVIEW_HISTORIES, openCurrentPreviewHistory, previewApprovalHistoryBytes,
} from '../../../../../../packages/core/src/persistence/repositories/fixtures/preview-approval-history.fixture.js';

type InvokeHandler = (event: unknown, id: unknown) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, InvokeHandler>(),
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() },
  getCore: vi.fn(), notify: vi.fn(), finished: vi.fn(), frame: { url: 'app://synthetic' },
}));
vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));
vi.mock('../../core-instance.js', () => ({ getCore: mocks.getCore }));
vi.mock('../../state-broadcast.js', () => ({ notifyStateChanged: mocks.notify }));
vi.mock('../../app-window.js', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 7 } }),
  isTrustedRendererUrl: (url: string) => url === 'app://synthetic',
}));
import { registerRuntimeApprovalHandlers } from './approval.js';

function trustedEvent() { return { sender: { id: 7, mainFrame: mocks.frame }, senderFrame: mocks.frame }; }

describe.each(['native', 'sqljs'] as const)('preview rejection preserves evidence (%s)', backend => {
  let directory: string;
  let db: AppDatabase;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.ipcMain.handle.mockImplementation((channel: string, handler: InvokeHandler) => mocks.handlers.set(channel, handler));
    registerRuntimeApprovalHandlers();
  });
  afterEach(() => { db?.close?.(); if (directory) rmSync(directory, { recursive: true, force: true }); });

  it.each(INVALID_PREVIEW_HISTORIES)('cancels without replacing %s bytes', async condition => {
    directory = mkdtempSync(join(tmpdir(), 'ax-preview-rejection-'));
    const filePath = join(directory, 'synthetic.db');
    const fixture = createPreviewApprovalFixture(filePath, condition);
    db = await openCurrentPreviewHistory(filePath, backend);
    const evidence = previewApprovalHistoryBytes(db);
    const store = new WorkflowStore(db);
    mocks.getCore.mockReturnValue({ store, runtime: { notifyExecutionFinished: mocks.finished } });
    expect(store.getExecution(fixture.pendingId)?.historyDiagnostics.some(d => d.source !== 'output')).toBe(true);

    await expect(mocks.handlers.get('ax:reject')!(trustedEvent(), fixture.approvalId)).resolves.toEqual({ ok: true });

    expect(store.getApproval(fixture.approvalId)?.status).toBe('rejected');
    expect(store.getExecution(fixture.pendingId)).toMatchObject({ status: 'cancelled', errorCode: 'approval_rejected' });
    expect(store.getExecution(fixture.pendingId)?.finishedAt).toBeTruthy();
    expect(mocks.finished).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledOnce();
    for (let opening = 0; opening < 3; opening++) {
      expect(JSON.stringify(previewApprovalHistoryBytes(db)) === JSON.stringify(evidence), 'original checkpoint/output/tail bytes changed').toBe(true);
      const reopenedStore = new WorkflowStore(db);
      expect(reopenedStore.getApproval(fixture.approvalId)?.status).toBe('rejected');
      expect(reopenedStore.getExecution(fixture.pendingId)?.historyDiagnostics.some(d => d.source !== 'output')).toBe(true);
      if (opening < 2) { db.close?.(); db = await openCurrentPreviewHistory(filePath, backend); }
    }
    mocks.getCore.mockReturnValue({ store: new WorkflowStore(db), runtime: { notifyExecutionFinished: mocks.finished } });
    await expect(mocks.handlers.get('ax:reject')!(trustedEvent(), fixture.approvalId)).rejects.toThrow('already being processed or resolved');
    expect(JSON.stringify(previewApprovalHistoryBytes(db)) === JSON.stringify(evidence), 'original checkpoint/output/tail bytes changed').toBe(true);
  });

  it('keeps the existing rejection event for validated history', async () => {
    directory = mkdtempSync(join(tmpdir(), 'ax-preview-rejection-control-'));
    const filePath = join(directory, 'synthetic.db');
    const fixture = createPreviewApprovalFixture(filePath, 'valid');
    db = await openCurrentPreviewHistory(filePath, backend);
    const store = new WorkflowStore(db);
    mocks.getCore.mockReturnValue({ store, runtime: { notifyExecutionFinished: mocks.finished } });
    await mocks.handlers.get('ax:reject')!(trustedEvent(), fixture.approvalId);
    expect(JSON.parse(store.getExecution(fixture.pendingId)!.logJson)).toEqual([
      ...fixture.checkpoint, fixture.waiting, expect.objectContaining({ code: 'approval_rejected' }),
    ]);
  });
});
