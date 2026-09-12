import { afterEach, expect, it, vi } from 'vitest';
import { drainWithin } from './drain.js';
afterEach(() => vi.useRealTimers());
it('bounds a stuck first stage and still starts the other drains', async () => {
  vi.useFakeTimers(); const later = vi.fn(async () => {});
  const result = drainWithin([() => new Promise(() => {}), later], 50);
  await vi.advanceTimersByTimeAsync(50);
  expect(await result).toBe(false); expect(later).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('waits for all stages and clears the deadline after success', async () => {
  vi.useFakeTimers(); expect(await drainWithin([async () => {}, async () => true], 50)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(await drainWithin([async () => { throw new Error('failed'); }], 50)).toBe(false);
});

it.each(['hydration', 'core'])('does not start engines when %s initialization finishes during shutdown', async (phase) => {
  vi.resetModules();
  vi.stubEnv('AX_E2E', '1');
  let finishHydration!: (value: null) => void;
  let finishIdle!: () => void;
  let finishCreation!: () => void;
  const creation = new Promise<void>(resolve => { finishCreation = resolve; });
  const hydration = new Promise<null>(resolve => { finishHydration = resolve; });
  const idle = new Promise<void>(resolve => { finishIdle = resolve; });
  let ready: Promise<void> | undefined;
  let beforeQuit: ((event: { preventDefault: () => void }) => void) | undefined;
  const core = {
    store: { getSetting: vi.fn(() => ({})), setSetting: vi.fn() },
    refreshAgentHarness: vi.fn(),
    scheduler: { start: vi.fn(), stop: vi.fn() },
    triggerEngine: { start: vi.fn(), stop: vi.fn(async () => {}), refreshSlackSocket: vi.fn() },
    runtime: { stopAccepting: vi.fn(), waitForIdle: vi.fn(() => idle) },
    workspaceSources: { subscribe: vi.fn(() => vi.fn()), stopAccepting: vi.fn(), waitForIdle: vi.fn(async () => {}) },
    agentHarness: { dispose: vi.fn(async () => {}) }, db: { close: vi.fn() },
  };
  const app = {
    whenReady: () => ({ then: (callback: () => Promise<void>) => { ready = callback(); return ready; } }),
    on: (name: string, callback: typeof beforeQuit) => { if (name === 'before-quit') beforeQuit = callback; },
    setPath: vi.fn(), quit: vi.fn(), exit: vi.fn(),
  };
  let publishedCore: typeof core | undefined;
  const createCore = vi.fn(async () => { if (phase === 'core') await creation; return core; });
  const hydrate = vi.fn(() => hydration);
  vi.doMock('electron', () => ({ app, dialog: { showErrorBox: vi.fn() } }));
  vi.doMock('@ax-studio/core', () => ({ createAxStudioCore: createCore,
    setDocumentEngineClient: vi.fn(), setWebhookSecretResolver: vi.fn(), shutdownCommandProcesses: async () => true }));
  vi.doMock('../core-instance', () => ({ getCoreIfInitialized: () => publishedCore, setCore: (value: typeof core) => { publishedCore = value; } }));
  vi.doMock('../app-window', () => ({ createMainWindow: vi.fn(), showMainWindow: vi.fn(), setQuiting: vi.fn() }));
  vi.doMock('../workspace-chat-registry.js', () => ({ abortAllWorkspaceChats: vi.fn() }));
  vi.doMock('../tray', () => ({ createTray: vi.fn() }));
  vi.doMock('../ipc/handlers', () => ({ registerIpcHandlers: vi.fn() }));
  vi.doMock('../env-file', () => ({ loadEnvFile: vi.fn(), purgeDisallowedEnvFileKeys: vi.fn() }));
  vi.doMock('../document-print.js', () => ({ printHtmlToPdf: vi.fn() }));
  vi.doMock('../webhook/connection.js', () => ({ getWebhookSecret: vi.fn() }));
  vi.doMock('../rdb/connection.js', () => ({ resolveRdbConnectionConfig: vi.fn() }));
  vi.doMock('../ai/config-file', () => ({ loadAiTomlIntoEnv: vi.fn(), migrateAiSecretsToOsStore: vi.fn() }));
  vi.doMock('../ai/provider-migrate.js', () => ({ migrateDesktopAiProvider: (value: unknown) => value }));
  vi.doMock('../state-broadcast.js', () => ({ notifyStateChanged: vi.fn(), notifyWorkspaceChatChanged: vi.fn(), notifyWorkspaceSourceChanged: vi.fn() }));
  vi.doMock('../data-paths.js', () => ({ initDesktopAxDataPaths: () => ({ cache: { chromium: 'fixture' } }), resolveDesktopDataRoot: vi.fn() }));
  vi.doMock('../data-migrate.js', () => ({ migrateAxDataIfNeeded: vi.fn() }));
  vi.doMock('../e2e-test-seam.js', () => ({ E2EDocumentEngineClient: vi.fn() }));
  vi.doMock('./connectors.js', () => ({ hydrateConnectorsForStartup: hydrate }));
  try {
    const { registerDesktopShutdown } = await import('./lifecycle.js');
    const { registerDesktopReadyHandler } = await import('./ready.js');
    registerDesktopShutdown();
    registerDesktopReadyHandler();
    await vi.waitFor(() => expect(phase === 'hydration' ? hydrate : createCore).toHaveBeenCalledOnce());
    beforeQuit!({ preventDefault: vi.fn() });
    if (phase === 'hydration') {
      await vi.waitFor(() => expect(core.triggerEngine.stop).toHaveBeenCalledOnce());
      finishIdle();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(core.db.close).not.toHaveBeenCalled();
    }
    finishCreation();
    finishHydration(null);
    finishIdle();
    await ready;
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
    expect(core.scheduler.start).not.toHaveBeenCalled();
    expect(core.triggerEngine.start).not.toHaveBeenCalled();
    expect(core.triggerEngine.refreshSlackSocket).not.toHaveBeenCalled();
    expect(core.db.close).toHaveBeenCalledOnce();
  } finally {
    finishHydration(null);
    finishIdle();
    finishCreation();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});
