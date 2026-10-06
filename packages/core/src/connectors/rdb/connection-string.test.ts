import { describe, expect, it } from 'vitest';
import { rdbConnectionIdentity, rdbTransportWarning, validateRdbConnectionString } from './config/validate.js';

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

describe('rdbConnectionIdentity', () => {
  it('drops passwords and secret query parameters but keeps the target', () => {
    const identity = rdbConnectionIdentity('postgresql://ax:s3cret-pw@db.example.com:5432/app?sslmode=require&sslpassword=k3y');
    expect(identity).not.toContain('s3cret-pw');
    expect(identity).not.toContain('k3y');
    expect(identity).toContain('db.example.com:5432/app');
    expect(identity).toContain('sslmode=require');
    expect(rdbConnectionIdentity('postgresql://ax:one@h/db')).toBe(rdbConnectionIdentity('postgresql://ax:two@h/db'));
  });
});

describe('rdbTransportWarning', () => {
  it('warns only for non-local hosts without TLS', () => {
    expect(rdbTransportWarning('postgres', 'postgresql://u:p@127.0.0.1/db')).toBeNull();
    expect(rdbTransportWarning('postgres', 'postgresql://u:p@localhost/db')).toBeNull();
    expect(rdbTransportWarning('postgres', 'postgresql://u:p@db.example.com/db')).toBe('rdb_remote_without_tls');
    expect(rdbTransportWarning('postgres', 'postgresql://u:p@db.example.com/db?sslmode=prefer')).toBe('rdb_remote_without_tls');
    expect(rdbTransportWarning('postgres', 'postgresql://u:p@db.example.com/db?sslmode=verify-full')).toBeNull();
    expect(rdbTransportWarning('mysql', 'mysql://u:p@10.0.0.5/db')).toBe('rdb_remote_without_tls');
    expect(rdbTransportWarning('mysql', 'mysql://u:p@10.0.0.5/db?ssl={"rejectUnauthorized":true}')).toBeNull();
  });
});
