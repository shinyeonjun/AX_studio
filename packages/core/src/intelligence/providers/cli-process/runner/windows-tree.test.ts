import { expect, it } from 'vitest';
import { runCommand } from './exec.js';

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

it.skipIf(process.platform !== 'win32')('cancels a synthetic owned Windows parent and its child', async () => {
  const controller = new AbortController();
  let pids: number[] = [];
  const script = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', () => console.log(JSON.stringify([process.pid, child.pid])));
    setInterval(() => {}, 1000);
  `;
  try {
    await expect(runCommand(process.execPath, ['-e', script], {
      timeoutMs: 5_000, abortSignal: controller.signal,
      onStdoutLine: line => {
        pids = JSON.parse(line) as number[];
        if (pids.length !== 2 || pids.some(pid => !Number.isInteger(pid) || pid <= 0)) throw new Error('invalid synthetic pid');
        controller.abort();
      },
    })).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(pids).toHaveLength(2);
    for (let i = 0; i < 100 && pids.some(alive); i++) await new Promise(resolve => setTimeout(resolve, 20));
    expect(pids.map(alive)).toEqual([false, false]);
  } finally {
    // These IDs came only from the two processes created by this test.
    for (const pid of pids) { if (alive(pid)) { try { process.kill(pid); } catch { /* Already exited. */ } } }
  }
}, 10_000);
