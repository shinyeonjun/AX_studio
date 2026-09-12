import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDesktop, launchDesktop, tempRunId } from '../lib/desktop-app.js';

if (process.env.AX_PRODUCT_QA_MODE === 'deterministic' && !process.env.AX_PRODUCT_QA_PRINT) {
  test('the shipped background search worker and its chunks load inside Electron', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-shipped-search-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot: join(root, 'profile'),
      runId: process.env.AX_PRODUCT_QA_RUN_ID ?? tempRunId(), scenarioId: 'shipped-background-search' });
    try {
      writeFileSync(join(root, 'report.txt'), 'needle from the shipped worker');
      const hits = await ctx.app.evaluate(async (_electron, path) => {
        const { Worker } = process.getBuiltinModule('worker_threads');
        if (!process.env.AX_SEARCH_WORKER_PATH) throw new Error('Search worker path was not configured');
        const worker = new Worker(process.env.AX_SEARCH_WORKER_PATH, { workerData: {
          folder: { id: 'fixture', label: 'Fixture', path, addedAt: new Date().toISOString() },
          query: 'needle', options: { limit: 1 },
        } });
        return new Promise<unknown>((resolve, reject) => {
          const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('Search worker timed out')); }, 15_000);
          worker.once('message', message => { clearTimeout(timeout); void worker.terminate(); resolve(message); });
          worker.once('error', error => { clearTimeout(timeout); void worker.terminate(); reject(error); });
          worker.once('exit', () => { clearTimeout(timeout); reject(new Error('Search worker exited without a result')); });
        });
      }, root);
      expect(hits).toEqual([expect.objectContaining({ snippet: 'needle from the shipped worker', score: 1 })]);
    } finally { await closeDesktop(ctx); rmSync(root, { recursive: true, force: true }); }
  });
}
