import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ run: vi.fn(), replacement: { name: 'next', dispose: vi.fn(async () => {}) } }));
vi.mock('./harness/run.js', () => ({ runAgent: state.run }));
vi.mock('./model/factory.js', () => ({ createModelProvider: () => state.replacement }));
import { AgentHarness } from './harness.js';
import { DEFAULT_AI_PROVIDER } from './settings/config.js';
it('keeps a retired provider alive until its in-flight run finishes', async () => {
  let release!: () => void;
  state.run.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
  const dispose = vi.fn(async () => {});
  const harness = new AgentHarness({ name: 'owned', generateStructured: vi.fn(), generateText: vi.fn(), dispose });
  const run = harness.run({} as any);
  harness.configure(DEFAULT_AI_PROVIDER);
  await Promise.resolve(); expect(dispose).not.toHaveBeenCalled();
  release(); await run; await harness.dispose();
  expect(dispose).toHaveBeenCalledOnce(); expect(state.replacement.dispose).toHaveBeenCalledOnce();
  await expect(harness.run({} as any)).rejects.toThrow('agent_harness_disposed');
});
