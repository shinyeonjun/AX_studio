import type { ConnectionEntry } from '../../../../../types/connection-entry';
import { connectionEntry, rdbTypeLabel } from '../../../../../ui/lib/connection-display';

export type RdbDatabaseItem = NonNullable<ConnectionEntry['databases']>[number];

export interface RdbConnectedItem {
  id: string;
  title: string;
  subtitle?: string;
  meta: string;
}

/** The connected databases; a summary from before several databases reads as the one default. */
export function rdbDatabasesFor(state: { connections?: ConnectionEntry[] } | null): RdbDatabaseItem[] {
  const rdbEntry = connectionEntry(state, 'rdb');
  if (rdbEntry?.databases?.length) return rdbEntry.databases;
  return rdbEntry?.connected && rdbEntry.dbType
    ? [
        {
          id: 'default',
          label: rdbEntry.label,
          dbType: rdbEntry.dbType,
          target: rdbEntry.target,
          allowedSchemas: rdbEntry.allowedSchemas,
          allowedTables: rdbEntry.allowedTables,
          rowLimit: rdbEntry.rowLimit,
        },
      ]
    : [];
}

/** The name a person knows a database by in the settings screens. */
export function rdbDatabaseTitle(database: RdbDatabaseItem): string {
  return database.label?.trim() || rdbTypeLabel(database.dbType);
}

export function rdbConnectedItemsFor(databases: RdbDatabaseItem[]): RdbConnectedItem[] {
  return databases.map((database) => ({
    id: database.id,
    title: rdbDatabaseTitle(database),
    subtitle: database.target,
    meta: [
      rdbTypeLabel(database.dbType),
      database.allowedTables?.length ? `테이블 ${database.allowedTables.length}개` : undefined,
      database.rowLimit != null ? `행 제한 ${database.rowLimit}` : undefined,
      database.needsReconnect ? '다시 연결 필요' : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
  }));
}

/** "쇼핑몰 DB"를 / "매출"을: the object particle that follows the name's last sound. */
export function withObjectParticle(name: string): string {
  const last = name.trim().at(-1) ?? '';
  const code = last.charCodeAt(0);
  let batchim: boolean;
  if (code >= 0xac00 && code <= 0xd7a3) {
    batchim = (code - 0xac00) % 28 !== 0;
  } else {
    // Latin letters and digits as read aloud in Korean: L, M, N and 0, 1, 3, 6, 7, 8 end in a consonant.
    batchim = /[lmn013678]/iu.test(last);
  }
  return `"${name}"${batchim ? '을' : '를'}`;
}

/** "1,000" and " 500 " are numbers people type; empty means the default. The host checks the range. */
export function parseRowLimitInput(text: string): number | undefined {
  const cleaned = text.replace(/[,\s]/gu, '');
  return cleaned ? Number(cleaned) : undefined;
}
