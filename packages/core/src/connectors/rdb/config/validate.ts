export function validateRdbConnectionString(
  type: 'mysql' | 'postgres',
  connectionString: string,
): string | null {
  const value = connectionString.trim();
  if (!value) return 'empty_connection_string';
  try {
    const url = new URL(value);
    if (type === 'postgres') {
      if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
        return 'invalid_postgres_connection_string';
      }
      return null;
    }
    if (url.protocol !== 'mysql:') return 'invalid_mysql_connection_string';
    return null;
  } catch {
    return 'invalid_connection_string';
  }
}

const SECRET_QUERY_KEY = /pass|secret|token|key|cert/iu;

/**
 * Stable identity for a connection string with credentials removed, so read
 * fingerprints do not become an offline oracle for the password.
 */
export function rdbConnectionIdentity(connectionString: string): string {
  const value = connectionString.trim();
  try {
    const url = new URL(value);
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEY.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hash = '';
    return url.toString();
  } catch {
    // Unparseable strings never reach a driver; still avoid hashing raw secrets.
    return value.replace(/(password|pwd)\s*=\s*[^;\s&]*/giu, '$1=');
  }
}

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const POSTGRES_TLS_MODES = new Set(['require', 'verify-ca', 'verify-full']);

/** Warning code when credentials and rows would cross the network in plaintext. */
export function rdbTransportWarning(type: 'mysql' | 'postgres', connectionString: string): string | null {
  let url: URL;
  try {
    url = new URL(connectionString.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!host || LOCAL_DB_HOSTS.has(host) || host.endsWith('.localhost')) return null;
  const params = url.searchParams;
  if (type === 'postgres') {
    const sslmode = params.get('sslmode')?.toLowerCase();
    const ssl = params.get('ssl')?.toLowerCase();
    if ((sslmode && POSTGRES_TLS_MODES.has(sslmode)) || ssl === 'true' || ssl === '1') return null;
  } else {
    const ssl = params.get('ssl');
    if (ssl && ssl !== 'false' && ssl !== '0') return null;
  }
  return 'rdb_remote_without_tls';
}
