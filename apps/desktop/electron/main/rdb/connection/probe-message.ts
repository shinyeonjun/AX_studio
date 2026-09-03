export function rdbProbeErrorMessage(probe: { error: string; detail?: string }): string {
  const detail = probe.detail ? ` (${probe.detail})` : '';
  switch (probe.error) {
    case 'invalid_postgres_connection_string':
      return 'PostgreSQL connection string 형식이 올바르지 않습니다. postgresql://user:pass@host:5432/db 형식을 사용해 주세요.';
    case 'invalid_mysql_connection_string':
      return 'MySQL connection string 형식이 올바르지 않습니다. mysql://user:pass@host:3306/db 형식을 사용해 주세요.';
    case 'invalid_connection_string':
      return 'connection string 형식이 올바르지 않습니다.';
    case 'empty_connection_string':
      return 'connection string이 필요합니다.';
    case 'postgres_connection_failed':
      return `PostgreSQL에 연결할 수 없습니다.${detail}`;
    case 'mysql_connection_failed':
      return `MySQL에 연결할 수 없습니다.${detail}`;
    default:
      return `SQLite 파일을 열 수 없습니다.${detail}`;
  }
}
