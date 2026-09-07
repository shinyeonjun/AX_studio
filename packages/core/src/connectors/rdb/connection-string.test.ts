import { describe, expect, it } from 'vitest';
import { validateRdbConnectionString } from './config.js';

describe('validateRdbConnectionString', () => {
  it('rejects http URLs for postgres and mysql', () => {
    expect(validateRdbConnectionString('postgres', 'http://127.0.0.1:5432/db')).toBe('invalid_postgres_connection_string');
    expect(validateRdbConnectionString('mysql', 'http://127.0.0.1:3306/db')).toBe('invalid_mysql_connection_string');
  });

  it('accepts canonical postgres and mysql URLs', () => {
    expect(validateRdbConnectionString('postgres', 'postgresql://ax_test:ax_test@127.0.0.1:5432/ax_test')).toBeNull();
    expect(validateRdbConnectionString('mysql', 'mysql://ax_test:ax_test@127.0.0.1:3306/ax_test')).toBeNull();
  });
});
