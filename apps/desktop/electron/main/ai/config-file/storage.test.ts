import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { isPackaged: true, getAppPath: () => state.dir } }));
vi.mock('../../data-paths.js', () => ({ getDesktopAxDataPaths: () => ({ config: state.dir }) }));

import { readAiToml, saveActiveAi, saveAiBrandPreferences, saveJevDecisionPreferences } from './storage.js';

describe('ai.toml storage', () => {
  beforeEach(async () => { state.dir = await mkdtemp(join(tmpdir(), 'ax-ai-toml-')); });
  afterEach(async () => { await rm(state.dir, { recursive: true, force: true }); });

  it('serializes concurrent read-modify-write saves so no field is lost', async () => {
    await Promise.all([
      saveActiveAi('claude', 'sonnet'),
      saveJevDecisionPreferences({ enabled: true, baseURL: 'https://jev.example' }),
      saveAiBrandPreferences('gpt', { model: 'gpt-5.4' }),
    ]);
    const config = await readAiToml();
    expect(config.active).toEqual({ brand: 'claude', model: 'sonnet' });
    expect(config.decision?.jev).toEqual({ enabled: true, baseURL: 'https://jev.example' });
    expect(config.providers.gpt).toEqual({ model: 'gpt-5.4' });
  });

  it('keeps the stored model when a partial update omits it', async () => {
    await saveAiBrandPreferences('claude', { model: 'claude-sonnet-4-6' });
    await saveAiBrandPreferences('claude', { model: undefined });
    expect((await readAiToml()).providers.claude).toEqual({ model: 'claude-sonnet-4-6' });
    await saveAiBrandPreferences('claude', { model: 'opus' });
    expect((await readAiToml()).providers.claude).toEqual({ model: 'opus' });
    expect(await readFile(join(state.dir, 'ai.toml'), 'utf8')).not.toContain('undefined');
  });
});
