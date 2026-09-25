import { execFile, type ChildProcess } from 'node:child_process';

/** Only processes spawned by this host are eligible for termination. */
export function terminateOwnedChild(child: ChildProcess, force = false): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, timeout: 2_000 }, error => {
        if (error && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
  } else {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
  }
}

export class CommandProcessRegistry {
  private accepting = true;
  private readonly active = new Map<ChildProcess, Promise<void>>();

  assertAccepting(): void {
    if (!this.accepting) throw new Error('command_host_stopping');
  }

  track(child: ChildProcess): void {
    const closed = new Promise<void>(resolve => {
      const release = () => { this.active.delete(child); resolve(); };
      child.once('close', release);
      child.once('error', () => { if (child.pid === undefined) release(); });
    });
    this.active.set(child, closed);
  }

  async shutdown(timeoutMs = 5_000): Promise<boolean> {
    this.accepting = false;
    const children = [...this.active.keys()];
    const closed = [...this.active.values()];
    for (const child of children) terminateOwnedChild(child);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settleDeadline!: (drained: boolean) => void;
    const deadline = new Promise<boolean>(resolve => {
      settleDeadline = resolve;
      timer = setTimeout(() => {
        for (const child of this.active.keys()) terminateOwnedChild(child, true);
        resolve(false);
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        Promise.all(closed).then(() => true),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
      settleDeadline(true);
    }
  }
}

export const commandProcesses = new CommandProcessRegistry();
export const shutdownCommandProcesses = (timeoutMs?: number): Promise<boolean> => commandProcesses.shutdown(timeoutMs);
