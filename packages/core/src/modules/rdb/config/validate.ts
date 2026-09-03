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
