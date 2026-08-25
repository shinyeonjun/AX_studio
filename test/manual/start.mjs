// One-command manual fixture: local REST API + seeded PostgreSQL container.
// Keeps running for interactive AX Studio testing; Ctrl+C tears everything down.
import { startRestFixture } from './rest-api.mjs';
import { startPostgresFixture } from './postgres.mjs';

const closers = [];

async function shutdown(code = 0) {
  console.log('\n[manual] shutting down fixtures');
  for (const close of closers.reverse()) {
    try {
      await close();
    } catch (err) {
      console.error('[manual] cleanup failed:', err instanceof Error ? err.message : err);
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
  const rest = await startRestFixture({});
  closers.push(rest.close);

  const pg = await startPostgresFixture({});
  closers.push(pg.close);

  console.log('');
  console.log('==============================================');
  console.log(' AX Studio 수동 테스트 픽스처 준비 완료');
  console.log('==============================================');
  console.log(` REST base URL   : ${rest.baseUrl}`);
  console.log(` PostgreSQL      : ${pg.connectionString}`);
  console.log(' 시드 테이블      : public.customers (5 rows)');
  console.log('');
  console.log(' 앱 연결 방법은 test/manual/README.md 를 참고하세요.');
  console.log(' Ctrl+C 를 누르면 REST 서버와 PostgreSQL 컨테이너가 정리됩니다.');
  setInterval(() => {}, 60_000);
} catch (err) {
  console.error('[manual] fixture start failed:', err instanceof Error ? err.message : err);
  await shutdown(1);
}
