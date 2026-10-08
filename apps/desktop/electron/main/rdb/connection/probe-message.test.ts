import { describe, expect, it } from 'vitest';
import { rdbProbeErrorMessage } from './probe-message.js';

describe('why a database connection failed, in words', () => {
  it.each([
    ['connect ECONNREFUSED 10.0.0.5:5432', 'DB 서버가 켜져 있는지'],
    ['timeout expired', '네트워크 연결이나 방화벽'],
    ['getaddrinfo ENOTFOUND db.example.com', '서버 이름을 확인'],
    ['password authentication failed for user "app"', '비밀번호가 맞지 않아요'],
    ['database "shop" does not exist', 'DB 이름을 확인'],
  ])('%s', (detail, words) => {
    const message = rdbProbeErrorMessage({ error: 'postgres_connection_failed', detail });
    expect(message).toContain(words);
    expect(message).not.toContain(detail);
  });

  it('keeps the plain advice, without the driver English, for anything else', () => {
    const message = rdbProbeErrorMessage({ error: 'mysql_connection_failed', detail: 'Something odd happened' });
    expect(message).toBe('MySQL에 연결할 수 없어요. 접속 주소, 사용자 이름, 비밀번호를 확인해 주세요.');
  });
});
