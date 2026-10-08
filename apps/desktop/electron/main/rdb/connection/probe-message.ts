/**
 * The driver's error says whose problem it is; everything used to be blamed on the address and
 * password, with the driver's English appended. Unknown errors keep only the plain advice.
 */
function serverConnectionReason(detail: string | undefined): string | undefined {
  const text = detail ?? '';
  if (/ECONNREFUSED/u.test(text)) return '서버가 연결을 받지 않았어요. 주소와 포트 번호가 맞는지, DB 서버가 켜져 있는지 확인해 주세요.';
  if (/ETIMEDOUT|timeout|timed out/iu.test(text)) return '서버에 닿지 못했어요. 네트워크 연결이나 방화벽 설정을 확인해 주세요.';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/u.test(text)) return '서버 주소를 찾지 못했어요. 접속 주소의 서버 이름을 확인해 주세요.';
  if (/password authentication failed|28P01|Access denied|ER_ACCESS_DENIED/iu.test(text)) return '사용자 이름이나 비밀번호가 맞지 않아요.';
  if (/does not exist|3D000|ER_BAD_DB_ERROR|Unknown database/iu.test(text)) return '이 이름의 데이터베이스를 찾지 못했어요. 접속 주소의 DB 이름을 확인해 주세요.';
  if (/self[- ]signed|certificate|SSL|TLS/iu.test(text)) return '보안 연결(SSL) 설정이 서버와 맞지 않아요. DB 관리자에게 연결 방법을 확인해 주세요.';
  return undefined;
}

export function rdbProbeErrorMessage(probe: { error: string; detail?: string }): string {
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
      return `PostgreSQL에 연결할 수 없어요. ${serverConnectionReason(probe.detail) ?? '접속 주소, 사용자 이름, 비밀번호를 확인해 주세요.'}`;
    case 'mysql_connection_failed':
      return `MySQL에 연결할 수 없어요. ${serverConnectionReason(probe.detail) ?? '접속 주소, 사용자 이름, 비밀번호를 확인해 주세요.'}`;
    default:
      return 'SQLite 파일을 열 수 없어요. 파일이 옮겨지거나 다른 프로그램에서 쓰는 중인지 확인해 주세요.';
  }
}

export function rdbProbeWarningMessage(warning: string): string {
  if (warning === 'rdb_remote_without_tls') {
    return '암호화되지 않은 연결이에요. 비밀번호와 조회한 데이터가 그대로 전송될 수 있어요. DB 관리자에게 암호화(SSL) 연결을 요청하는 것을 권장해요.';
  }
  return warning;
}
