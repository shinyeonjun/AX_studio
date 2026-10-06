import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxCore } from '../../core-instance.js';

const mocks = vi.hoisted(() => ({
  readAiToml: vi.fn(),
  getJevSecret: vi.fn(),
  getAiConfigPath: vi.fn(() => 'ai.toml'),
  getEnvFilePath: vi.fn(() => '.env'),
  getDesktopAxDataPaths: vi.fn(() => ({ root: 'data' })),
  isGoogleOAuthConfigured: vi.fn(() => false),
}));

vi.mock('../../ai/config-file.js', () => ({
  readAiToml: mocks.readAiToml,
  getJevSecret: mocks.getJevSecret,
  getAiConfigPath: mocks.getAiConfigPath,
}));
vi.mock('../../env-file.js', () => ({ getEnvFilePath: mocks.getEnvFilePath }));
vi.mock('../../gmail/oauth.js', () => ({ isGoogleOAuthConfigured: mocks.isGoogleOAuthConfigured }));
vi.mock('../../data-paths.js', () => ({ getDesktopAxDataPaths: mocks.getDesktopAxDataPaths }));

import { buildConnectorState } from './connector-state.js';

describe('buildConnectorState', () => {
  afterEach(() => vi.resetAllMocks());

  it('reads the connection snapshot once and starts independent config reads in parallel', async () => {
    let resolveAiToml!: (value: { providers: {}; decision: {} }) => void;
    mocks.readAiToml.mockReturnValue(new Promise((resolve) => { resolveAiToml = resolve; }));
    mocks.getJevSecret.mockResolvedValue('configured');
    const connections = vi.fn(() => []);
    const core = {
      store: { getSetting: vi.fn(() => undefined), getConnections: connections },
      triggerEngine: {
        slackSocketStatus: () => ({ phase: 'disconnected' }),
        slackSocketActive: () => false,
        pushTransportStatus: () => undefined,
      },
    } as unknown as AxCore;

    const pendingState = buildConnectorState(core);
    expect(mocks.readAiToml).toHaveBeenCalledOnce();
    expect(mocks.getJevSecret).toHaveBeenCalledOnce();
    expect(connections).toHaveBeenCalledOnce();

    resolveAiToml({ providers: {}, decision: {} });
    await expect(pendingState).resolves.toMatchObject({ connections: [] });
  });

  it('still resolves when a stored secret cannot be decrypted', async () => {
    mocks.readAiToml.mockResolvedValue({ providers: {}, decision: {} });
    mocks.getJevSecret.mockRejectedValue(Object.assign(new Error('decrypt'), { code: 'credential_decrypt_failed' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const core = {
      store: { getSetting: vi.fn(() => undefined), getConnections: vi.fn(() => []) },
      triggerEngine: {
        slackSocketStatus: () => ({ phase: 'disconnected' }),
        slackSocketActive: () => false,
        pushTransportStatus: () => undefined,
      },
    } as unknown as AxCore;

    await expect(buildConnectorState(core)).resolves.toMatchObject({ jevDecisionConfigured: false });
    warn.mockRestore();
  });
});
