import type { AppDatabase } from '../db.js';
import * as usageRepo from '../repositories/usage-repository.js';
import type { StoredUsageCall } from '../../intelligence/usage/usage-recorder.js';

/** Model calls counted for the Usage screen; pruned with the rest of the history. */
export class UsageStore {
  constructor(private readonly db: AppDatabase) {}

  recordUsageCall(call: StoredUsageCall) { usageRepo.insertUsageCall(this.db, call); }

  listUsageCallsSince(since: Date) { return usageRepo.listUsageCallsSince(this.db, since.toISOString()); }
}
