import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Session {
  workspace: Promise<string>;
  active: boolean;
  resume?: string;
}

interface SessionLease {
  dir: string;
  resume?: string;
  remember(resume: string): void;
  release(): Promise<void>;
  abandon(): void;
}

/** Bounded resume metadata; directories are exclusively created and owned here. */
export class CursorSessions {
  private readonly sessions = new Map<string, Session>();
  private disposed = false;

  async acquire(id: string): Promise<SessionLease> {
    if (this.disposed) throw new Error('provider_disposed');
    let session = this.sessions.get(id);
    if (session?.active) throw new Error('provider_session_busy');
    if (!session) {
      if (this.sessions.size >= 32) {
        const idle = [...this.sessions].find(([, entry]) => !entry.active);
        if (!idle) throw new Error('provider_sessions_full');
        this.sessions.delete(idle[0]);
        await this.remove(idle[1]);
        // Re-check after filesystem work because another request may have acquired this key.
        return this.acquire(id);
      }
      session = { workspace: mkdtemp(join(tmpdir(), 'ax-cursor-session-')), active: true };
      this.sessions.set(id, session);
    } else {
      session.active = true;
      this.sessions.delete(id); this.sessions.set(id, session);
    }
    const owned = session;
    try {
      const dir = await owned.workspace;
      let released = false;
      return {
        dir, resume: owned.resume,
        remember: (resume: string) => { owned.resume = resume; },
        abandon: () => {
          released = true;
          this.sessions.delete(id);
          console.error('[AX] Child exit unconfirmed; retained Cursor workspace:', dir);
        },
        release: async () => {
          if (released) return;
          released = true;
          owned.active = false;
          if (this.disposed) { this.sessions.delete(id); await this.remove(owned); }
        },
      };
    } catch (error) { this.sessions.delete(id); throw error; }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const [id, session] of this.sessions) {
      if (!session.active) { this.sessions.delete(id); await this.remove(session); }
    }
  }

  private async remove(session: Session): Promise<void> {
    // The path is the exact mkdtemp result, never a caller-supplied session ID.
    await rm(await session.workspace, { recursive: true, force: true });
  }
}
