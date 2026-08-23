import type { AppDatabase } from '../db.js';
import type { SettingRow, ConnectionRow } from '../rows.js';

export function getSetting<T>(db: AppDatabase, key: string, defaultValue: T): T {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value_json) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`설정 ${key}의 JSON이 손상되었습니다: ${message}`), {
      code: 'invalid_setting_json',
      settingKey: key,
    });
  }
}

export function setSetting(db: AppDatabase, key: string, value: unknown) {
  const valueJson = JSON.stringify(value);
  db
    .prepare(
      `INSERT INTO settings (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .run(key, valueJson);
}

export function setConnection(
  db: AppDatabase,
  connector: string,
  connected: boolean,
  config?: Record<string, unknown>,
) {
  const configJson = config ? JSON.stringify(config) : null;
  db
    .prepare(
      `INSERT INTO connections (connector, connected, config_json) VALUES (?, ?, ?)
       ON CONFLICT(connector) DO UPDATE SET connected = excluded.connected, config_json = excluded.config_json`,
    )
    .run(connector, connected ? 1 : 0, configJson);
}

export function getConnections(
  db: AppDatabase,
): Array<{ connector: string; connected: boolean; config?: Record<string, unknown>; configCorrupted?: boolean }> {
  const rows = db.prepare('SELECT connector, connected, config_json FROM connections').all() as unknown as ConnectionRow[];
  return rows.map((c) => {
    if (!c.config_json) {
      return { connector: c.connector, connected: Boolean(c.connected), config: undefined };
    }
    try {
      const parsed: unknown = JSON.parse(c.config_json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('연결 설정은 JSON 객체여야 합니다.');
      }
      return {
        connector: c.connector,
        connected: Boolean(c.connected),
        config: parsed as Record<string, unknown>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[settings] connection JSON corrupted for ${c.connector}: ${message}`);
      return {
        connector: c.connector,
        connected: false,
        config: undefined,
        configCorrupted: true,
      };
    }
  });
}
