import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../../db.js';
import type { WorkspaceChatRecord } from './contracts.js';

interface RevisionOwner {
  epoch: string;
  versions: Map<string, number>;
  participating: Set<string>;
}
// All repository/store writers of this single main-process DB share the owner.
const owners = new WeakMap<AppDatabase, RevisionOwner>();
function owner(db: AppDatabase): RevisionOwner {
  let held = owners.get(db);
  if (!held) {
    held = { epoch: randomUUID(), versions: new Map(), participating: new Set() };
    owners.set(db, held);
  }
  return held;
}

export function workspaceChatRevision(db: AppDatabase, id: string): string {
  const held = owner(db);
  return `${held.epoch}:${held.versions.get(id) ?? 0}`;
}

/** Restore participation from host-authored transcript JSON without a migration. */
export function registerWorkspaceChatRevisionFence(db: AppDatabase, id: string): void {
  owner(db).participating.add(id);
}

export function assertWorkspaceChatRevision(db: AppDatabase, id: string, expected: string | undefined,
  firstParticipation = false): void {
  const required = firstParticipation || owner(db).participating.has(id);
  if ((required && expected !== workspaceChatRevision(db, id))
    || (expected !== undefined && !expected.startsWith(`${owner(db).epoch}:`))) {
    throw Object.assign(new Error('workspace_chat_revision_conflict'), { code: 'workspace_chat_revision_conflict' });
  }
}

/** Call only after a synchronous committed mutation; participation and first save are one boundary. */
export function commitWorkspaceChatRevision(db: AppDatabase, record: WorkspaceChatRecord,
  participate = false): WorkspaceChatRecord {
  const held = owner(db);
  held.versions.set(record.id, (held.versions.get(record.id) ?? 0) + 1);
  if (participate) held.participating.add(record.id);
  return { ...record, transcriptRevision: workspaceChatRevision(db, record.id) };
}

export function invalidateWorkspaceChatRevision(db: AppDatabase, id: string): void {
  const held = owner(db);
  held.versions.set(id, (held.versions.get(id) ?? 0) + 1);
}
