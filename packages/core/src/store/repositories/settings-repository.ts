import type { AppDatabase } from '../db.js';
import type { SettingRow, ConnectionRow } from '../rows.js';

export function getSetting<T>(db: AppDatabase, key: string, defaultValue: T): T {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
  if (!row) return defaultValue;
  return JSON.parse(row.value_json) as T;
}

export function setSetting(db: AppDatabase, key: string, value: unknown) {
  const valueJson = JSON.stringify(value);
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (existing) {
    db.prepare('UPDATE settings SET value_json = ? WHERE key = ?').run(valueJson, key);
  } else {
    db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)').run(key, valueJson);
  }
}

export function setConnection(
  db: AppDatabase,
  connector: string,
  connected: boolean,
  config?: Record<string, unknown>,
) {
  const configJson = config ? JSON.stringify(config) : null;
  const existing = db.prepare('SELECT connector FROM connections WHERE connector = ?').get(connector);
  if (existing) {
    db
      .prepare('UPDATE connections SET connected = ?, config_json = ? WHERE connector = ?')
      .run(connected ? 1 : 0, configJson, connector);
  } else {
    db
      .prepare('INSERT INTO connections (connector, connected, config_json) VALUES (?, ?, ?)')
      .run(connector, connected ? 1 : 0, configJson);
  }
}

export function getConnections(db: AppDatabase): Array<{ connector: string; connected: boolean; config?: Record<string, unknown> }> {
  const rows = db.prepare('SELECT connector, connected, config_json FROM connections').all() as unknown as ConnectionRow[];
  return rows.map((c) => ({
    connector: c.connector,
    connected: Boolean(c.connected),
    config: c.config_json ? JSON.parse(c.config_json) : undefined,
  }));
}
