import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiBrandConfigurationActions } from './configuration-actions';

function setup(ax: Record<string, unknown>, apiKeyDraft = 'sk-new') {
  vi.stubGlobal('window', { ax });
  const messages: Array<[string, boolean | undefined]> = [];
  const actions = createAiBrandConfigurationActions({
    brand: 'openai', mode: 'api', model: 'gpt', apiKeyDraft, cliProviders: [], brandSecrets: {},
    verifiedCli: {}, verifiedApi: {}, canSave: true,
    onRefresh: async () => undefined, refreshDetection: async () => undefined,
    setApiKeyDraft: () => undefined, setApiKeyConfigured: () => undefined,
    setMessage: (text: string, isError?: boolean) => { messages.push([text, isError]); },
    setSaving: () => undefined, setVerifiedApi: () => undefined,
  } as never);
  return { actions, messages };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('saving an AI with a newly typed key', () => {
  it('checks the key, keeps it, and puts this AI to use in one save', async () => {
    const ax = {
      testAiApi: vi.fn(async () => ({ ok: true, label: 'OpenAI', masked: 'sk-…new' })),
      saveAiBrandConfig: vi.fn(async () => ({ ok: true })),
      setAiProvider: vi.fn(async () => undefined),
    };
    const { actions, messages } = setup(ax);
    await actions.save();
    expect(ax.testAiApi).toHaveBeenCalledWith('openai', 'sk-new', 'api');
    expect(ax.saveAiBrandConfig).toHaveBeenCalledWith('openai', { mode: 'api', model: 'gpt' });
    expect(ax.setAiProvider).toHaveBeenCalledWith({ brand: 'openai', mode: 'api', model: 'gpt' });
    expect(messages.at(-1)?.[0]).toContain('사용 중');
  });

  it('keeps nothing and switches nothing when the key does not work', async () => {
    const ax = {
      testAiApi: vi.fn(async () => { throw new Error('API 키가 올바르지 않습니다.'); }),
      saveAiBrandConfig: vi.fn(async () => ({ ok: true })),
      setAiProvider: vi.fn(async () => undefined),
    };
    const { actions, messages } = setup(ax);
    await actions.save();
    expect(ax.saveAiBrandConfig).not.toHaveBeenCalled();
    expect(ax.setAiProvider).not.toHaveBeenCalled();
    expect(messages.at(-1)?.[1]).toBe(true);
  });
});
