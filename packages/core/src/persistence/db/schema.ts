import type { AppDatabase } from './types.js';
import { INITIAL_SCHEMA_SQL } from './schema/ddl.js';
import { applyLegacyMigrations } from './schema/legacy.js';

export function applyMigrations(db: AppDatabase): void {
  db.exec(INITIAL_SCHEMA_SQL);
  applyLegacyMigrations(db);
}
