import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionOutput } from '@ax-studio/core';

// Match the repository's hook unit-test seam; no desktop/browser profile is opened.
const hooks = vi.hoisted(() => ({ cursor: 0, values: [0, undefined, '', false] as unknown[],
  setters: Array.from({ length: 4 }, () => vi.fn()), effect: undefined as undefined | (() => void | (() => void)) }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => { const index = hooks.cursor++; return [hooks.values[index], hooks.setters[index]]; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effect = effect; },
}));
import { CalculatedOutput } from './calculated-output.js';

const output: ExecutionOutput = { version: 1, fields: [{ path: 'total', valueJson: '42' }] };
const getExecutionOutput = vi.fn();
function render(attempt: number, value?: ExecutionOutput, error = '') {
  hooks.cursor = 0;
  hooks.values = [attempt, value, error, false];
  return renderToStaticMarkup(<CalculatedOutput executionId="synthetic" />);
}

describe('lazy calculated output hook', () => {
  beforeEach(() => {
    hooks.setters.forEach(setter => setter.mockReset());
    getExecutionOutput.mockReset();
    vi.stubGlobal('window', { ax: { getExecutionOutput } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not request a result on initial render', () => {
    expect(render(0)).toContain('계산 결과 보기');
    hooks.effect?.();
    expect(getExecutionOutput).not.toHaveBeenCalled();
  });

  it('loads a result after an explicit attempt and ends its loading state', async () => {
    getExecutionOutput.mockResolvedValue(output);
    render(1);
    hooks.effect?.();
    expect(getExecutionOutput).toHaveBeenCalledExactlyOnceWith('synthetic');
    expect(hooks.setters[3]).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(hooks.setters[1]).toHaveBeenCalledWith(output));
    await vi.waitFor(() => expect(hooks.setters[3]).toHaveBeenLastCalledWith(false));
  });

  it('keeps an error visible and supports a fresh explicit retry', async () => {
    getExecutionOutput.mockRejectedValueOnce(new Error('invalid_execution_output')).mockResolvedValueOnce(output);
    render(1);
    hooks.effect?.();
    await vi.waitFor(() => expect(hooks.setters[2]).toHaveBeenCalledWith('invalid_execution_output'));
    const markup = render(1, undefined, 'invalid_execution_output');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('계산 결과 다시 불러오기');
    render(2);
    hooks.effect?.();
    await vi.waitFor(() => expect(hooks.setters[1]).toHaveBeenCalledWith(output));
    expect(getExecutionOutput).toHaveBeenCalledTimes(2);
  });

  it.each(['success', 'failure'] as const)('ignores a late %s after unmount', async outcome => {
    let resolve!: (value: ExecutionOutput) => void;
    let reject!: (reason: Error) => void;
    getExecutionOutput.mockReturnValue(new Promise<ExecutionOutput>((yes, no) => { resolve = yes; reject = no; }));
    render(1);
    const cleanup = hooks.effect?.();
    if (typeof cleanup === 'function') cleanup();
    if (outcome === 'success') resolve(output); else reject(new Error('late failure'));
    await new Promise<void>(done => setTimeout(done, 0));
    expect(hooks.setters[1]).not.toHaveBeenCalled();
    expect(hooks.setters[2]).toHaveBeenCalledExactlyOnceWith('');
    expect(hooks.setters[3]).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('renders the v1 value as escaped text rather than HTML', () => {
    const markup = render(1, { version: 1, fields: [{ path: 'text', valueJson: JSON.stringify('<script>synthetic</script>') }] });
    expect(markup).toContain('&lt;script&gt;synthetic&lt;/script&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('계산 결과 보기');
    expect(getExecutionOutput).not.toHaveBeenCalled();
  });
});
