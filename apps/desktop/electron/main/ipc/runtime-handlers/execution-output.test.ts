import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionOutput } from '@ax-studio/core';

type InvokeHandler = (event: unknown, id: unknown) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, InvokeHandler>(),
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  store: { getExecutionOutput: vi.fn(), deleteExecution: vi.fn(), clearExecutions: vi.fn() },
  notify: vi.fn(),
  frame: { url: 'app://synthetic' },
}));
vi.mock('electron', () => ({ ipcMain: mocks.ipcMain, contextBridge: mocks.contextBridge, ipcRenderer: mocks.ipcRenderer }));
vi.mock('../../core-instance.js', () => ({ getCore: () => ({ store: mocks.store }) }));
vi.mock('../../state-broadcast.js', () => ({ notifyStateChanged: mocks.notify }));
vi.mock('../../app-window.js', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 7 } }),
  isTrustedRendererUrl: (url: string) => url === 'app://synthetic',
}));

import { registerRuntimeExecutionHandlers } from './execution.js';

const output: ExecutionOutput = { version: 1, fields: [{ path: 'total', valueJson: '42' }] };
function trustedEvent() { return { sender: { id: 7, mainFrame: mocks.frame }, senderFrame: mocks.frame }; }

describe('historical output IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.store.getExecutionOutput.mockReset().mockReturnValue(output);
    mocks.ipcMain.handle.mockImplementation((channel: string, handler: InvokeHandler) => mocks.handlers.set(channel, handler));
    registerRuntimeExecutionHandlers();
  });

  it('returns only the bounded lazy result through the existing trusted-sender wrapper', async () => {
    await expect(mocks.handlers.get('ax:getExecutionOutput')!(trustedEvent(), 'synthetic-result')).resolves.toEqual(output);
    expect(mocks.store.getExecutionOutput).toHaveBeenCalledExactlyOnceWith('synthetic-result');
    expect(mocks.store.deleteExecution).not.toHaveBeenCalled();
    expect(mocks.store.clearExecutions).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '   ', 42, {}, [], 'x'.repeat(129)])('rejects an invalid ID before accessing the Store (%s)', async id => {
    await expect(mocks.handlers.get('ax:getExecutionOutput')!(trustedEvent(), id)).rejects.toThrow();
    expect(mocks.store.getExecutionOutput).not.toHaveBeenCalled();
  });

  it('rejects an untrusted sender and a different frame before accessing the Store', async () => {
    expect(() => mocks.handlers.get('ax:getExecutionOutput')!({ ...trustedEvent(), sender: { id: 8, mainFrame: mocks.frame } }, 'id'))
      .toThrow('untrusted_ipc_sender');
    expect(() => mocks.handlers.get('ax:getExecutionOutput')!({ ...trustedEvent(), senderFrame: { url: 'app://synthetic' } }, 'id'))
      .toThrow('untrusted_ipc_frame');
    expect(mocks.store.getExecutionOutput).not.toHaveBeenCalled();
  });

  it.each(['execution_not_found', 'execution_output_unavailable', 'invalid_execution_output', 'execution_output_limit_exceeded'])
    ('propagates %s without changing execution state', async code => {
      mocks.store.getExecutionOutput.mockImplementation(() => { throw new Error(code); });
      await expect(mocks.handlers.get('ax:getExecutionOutput')!(trustedEvent(), 'synthetic-result')).rejects.toThrow(code);
      expect(mocks.notify).not.toHaveBeenCalled();
      expect(mocks.store.deleteExecution).not.toHaveBeenCalled();
    });

  it('exposes the same lazy read in preload without invoking it on startup', async () => {
    await import('../../../preload/index.js');
    const api = mocks.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'ax')?.[1] as
      { getExecutionOutput(id: string): Promise<ExecutionOutput> };
    expect(mocks.ipcRenderer.invoke).not.toHaveBeenCalled();
    mocks.ipcRenderer.invoke.mockResolvedValue(output);
    await expect(api.getExecutionOutput('synthetic-result')).resolves.toEqual(output);
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith('ax:getExecutionOutput', 'synthetic-result');
  });
});
