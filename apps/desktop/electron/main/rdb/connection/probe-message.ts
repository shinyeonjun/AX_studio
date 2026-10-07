export function rdbProbeErrorMessage(probe: { error: string; detail?: string }): string {
  const detail = probe.detail ? ` (${probe.detail})` : '';
  switch (probe.error) {
    case 'invalid_postgres_connection_string':
      return '접속 주소 형식이 올바르지 않아요. 예: postgresql://사용자:비밀번호@주소:5432/DB이름';
    case 'invalid_mysql_connection_string':
      return '접속 주소 형식이 올바르지 않아요. 예: mysql://사용자:비밀번호@주소:3306/DB이름';
    case 'invalid_connection_string':
      return '접속 주소 형식이 올바르지 않아요. 예: postgresql://사용자:비밀번호@주소:5432/DB이름';
    case 'empty_connection_string':
      return '접속 주소를 입력해 주세요.';
    case 'postgres_connection_failed':
      return `PostgreSQL에 연결할 수 없어요. 접속 주소, 사용자 이름, 비밀번호를 확인해 주세요.${detail}`;
    case 'mysql_connection_failed':
      return `MySQL에 연결할 수 없어요. 접속 주소, 사용자 이름, 비밀번호를 확인해 주세요.${detail}`;
    default:
      return `SQLite 파일을 열 수 없어요. 파일이 옮겨지거나 다른 프로그램에서 쓰는 중인지 확인해 주세요.${detail}`;
  }
}

export function rdbProbeWarningMessage(warning: string): string {
  if (warning === 'rdb_remote_without_tls') {
    return '암호화되지 않은 연결이에요. 비밀번호와 조회한 데이터가 그대로 전송될 수 있어요. DB 관리자에게 암호화(SSL) 연결을 요청하는 것을 권장해요.';
  }
  return warning;
}
