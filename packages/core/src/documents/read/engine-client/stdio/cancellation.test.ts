import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = vi.hoisted(() => vi.fn(async () => ({
  stdout: JSON.stringify({ ok: true, data: { engine: 'synthetic', templateImages: [], exampleImages: [] } }),
  stderr: '', exitCode: 0,
})));
vi.mock('../../../../intelligence/agent/model/cli-process.js', () => ({ runCommand: run }));
import { requestDocumentEngine } from './request.js';
import { StdioDocumentEngineClient } from './client.js';

beforeEach(() => run.mockClear());

function client() {
  return new StdioDocumentEngineClient({
    pythonPath: process.execPath, workerScript: process.execPath,
    workerCwd: process.cwd(), artifactRoot: process.cwd(),
  });
}

function transportOptions() { return (run.mock.calls[0] as unknown as [string, string[], Record<string, unknown>])[2]; }

describe('document worker cancellation ownership', () => {
  it('does not inspect a file or invoke a worker after cancellation', async () => {
    const instance = client();
    const signal = AbortSignal.abort();
    await expect(instance.ingest('missing-synthetic.pdf', {}, { abortSignal: signal })).rejects.toBeInstanceOf(Error);
    await expect(requestDocumentEngine({ pythonPath: process.execPath, workerScript: 'missing-worker',
      workerCwd: process.cwd(), artifactRoot: process.cwd(), timeoutMs: 100, abortSignal: signal }, 'ping', {})).rejects.toBeInstanceOf(Error);
    expect(run).not.toHaveBeenCalled();
  });
  it('forwards a per-request signal to the command runner', async () => {
    const signal = new AbortController().signal;
    const options = { pythonPath: process.execPath, workerScript: process.execPath,
      workerCwd: process.cwd(), artifactRoot: process.cwd(), timeoutMs: 100, abortSignal: signal };
    await requestDocumentEngine(options, 'ping', {});
    expect(transportOptions().abortSignal).toBe(signal);
    expect(String(transportOptions().input)).not.toContain('abortSignal');
  });

  it('keeps the shared client cancellable per ping without serializing the signal', async () => {
    const signal = new AbortController().signal;
    const instance = client();
    await instance.ping({ abortSignal: signal });
    expect(transportOptions().abortSignal).toBe(signal);
    expect(JSON.parse(String(transportOptions().input)).params).toEqual({});
  });

  it('forwards pair analysis cancellation independently for concurrent calls', async () => {
    const instance = client();
    const signals = [new AbortController().signal, new AbortController().signal];
    await Promise.all(signals.map(signal => instance.pdfReportAnalyze(
      'synthetic-template.pdf', 'synthetic-example.pdf', { abortSignal: signal })));
    expect(run.mock.calls.map(call => (call as unknown as [string, string[], Record<string, unknown>])[2].abortSignal)).toEqual(signals);
  });
});
