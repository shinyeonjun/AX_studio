import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';

export async function createSqliteCustomersFixture(): Promise<{ filePath: string; cleanup: () => void }> {
  const root = mkdtempSync(join(tmpdir(), 'ax-rdb-sqlite-'));
  const filePath = join(root, 'customers.sqlite');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      priority TEXT NOT NULL
    );
    INSERT INTO customers (id, name, priority) VALUES
      (1, 'AsterTech', 'critical'),
      (2, 'Naver', 'normal');
    CREATE TABLE secret_table (id INTEGER PRIMARY KEY);
  `);
  writeFileSync(filePath, Buffer.from(db.export()));
  db.close();
  return {
    filePath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
