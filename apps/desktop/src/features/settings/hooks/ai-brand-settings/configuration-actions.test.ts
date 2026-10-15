import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiBrandConfigurationActions } from './configuration-actions';

function setup(ax: Record<string, unknown>, installed: boolean) {
  vi.stubGlobal('window', { ax });
  const messages: Array<[string, boolean | undefined]> = [];
  const actions = createAiBrandConfigurationActions({
    brand: 'gpt', model: 'gpt-5.5', canSave: true, verifiedCli: {},
    cliProviders: [{ id: 'codex-cli', label: 'Codex CLI', description: '', installed, models: [], defaultModel: 'gpt-5.4' }],
    onRefresh: async () => undefined,
    refreshDetection: async () => ({ detected: [], aiConfig: { path: '', providers: {} } }),
    setMessage: (text: string, isError?: boolean) => { messages.push([text, isError]); },
    setSaving: () => undefined,
  });
  return { actions, messages };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('saving an AI', () => {
  it('keeps the model and puts this AI to use when its CLI is installed', async () => {
    const ax = { saveAiBrandConfig: vi.fn(async () => ({ ok: true })), setAiProvider: vi.fn(async () => undefined) };
    const { actions, messages } = setup(ax, true);
    await actions.save();
    expect(ax.saveAiBrandConfig).toHaveBeenCalledWith('gpt', { model: 'gpt-5.5' });
    expect(ax.setAiProvider).toHaveBeenCalledWith({ brand: 'gpt', model: 'gpt-5.5' });
    expect(messages.at(-1)?.[0]).toContain('사용 중');
  });

  it('only keeps the model while the CLI is not installed', async () => {
    const ax = { saveAiBrandConfig: vi.fn(async () => ({ ok: true })), setAiProvider: vi.fn(async () => undefined) };
    const { actions, messages } = setup(ax, false);
    await actions.save();
    expect(ax.setAiProvider).not.toHaveBeenCalled();
    expect(messages.at(-1)).toEqual(['설정을 저장했어요.', undefined]);
  });
});
