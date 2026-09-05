import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface ReportCheckpoint {
  version: 1;
  identity: string;
  status: 'running' | 'failed' | 'completed';
  stages: Record<string, { digest: string; value: unknown }>;
}

export function reportDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Only explicit retries reuse evidence, within the original chat session. */
export class ReportCheckpointStore {
  constructor(private readonly root: string) {}

  read(sessionId: string, executionId: string): ReportCheckpoint | undefined {
    const path = join(this.root, reportDigest(sessionId), `${reportDigest(executionId)}.json`);
    if (!existsSync(path)) return undefined;
    const envelope: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!envelope || typeof envelope !== 'object' || !('payload' in envelope) || !('digest' in envelope)
        || reportDigest(envelope.payload) !== envelope.digest) throw new Error('report_checkpoint_corrupt');
    const payload = envelope.payload as ReportCheckpoint;
    if (payload.version !== 1 || typeof payload.identity !== 'string' || !payload.stages
        || !['running', 'failed', 'completed'].includes(payload.status)) throw new Error('report_checkpoint_incompatible');
    return payload;
  }

  write(sessionId: string, executionId: string, checkpoint: ReportCheckpoint): void {
    const directory = join(this.root, reportDigest(sessionId));
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${reportDigest(executionId)}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ payload: checkpoint, digest: reportDigest(checkpoint) }), { flag: 'wx' });
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) rmSync(temporary);
    }
  }
}
