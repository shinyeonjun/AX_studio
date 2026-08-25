// Seeded PostgreSQL fixture in Docker for manual AX Studio testing.
// Owns only its container (no volume/network is created) and removes it on exit.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONTAINER = 'ax-manual-postgres';
const DEFAULT_PORT = Number(process.env.AX_MANUAL_PG_PORT || 54329);
const PASSWORD = 'axstudio';
const DATABASE = 'axmanual';
const IMAGE = 'postgres:16-alpine';

const SEED_SQL = `
CREATE TABLE IF NOT EXISTS public.customers (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  plan text NOT NULL,
  monthly_fee integer NOT NULL,
  signed_up date NOT NULL
);
TRUNCATE public.customers;
INSERT INTO public.customers (id, name, email, plan, monthly_fee, signed_up) VALUES
  (1, '김민준', 'minjun.kim@example.com', 'pro', 49000, '2025-11-03'),
  (2, '이서연', 'seoyeon.lee@example.com', 'basic', 19000, '2026-01-14'),
  (3, '박지훈', 'jihoon.park@example.com', 'pro', 49000, '2026-02-27'),
  (4, '최수아', 'sua.choi@example.com', 'enterprise', 190000, '2026-03-09'),
  (5, '정도윤', 'doyoon.jung@example.com', 'basic', 19000, '2026-05-21');
`;

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options });
}

function assertDockerAvailable() {
  const probe = docker(['info', '--format', '{{.ServerVersion}}']);
  if (probe.status !== 0) {
    throw new Error(
      'Docker 데몬에 연결할 수 없습니다. Docker Desktop을 실행한 뒤 다시 시도하세요.\n' +
        (probe.stderr || probe.stdout || ''),
    );
  }
}

function removeContainer() {
  docker(['rm', '-f', CONTAINER]);
}

async function waitForReady(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const check = docker(['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', DATABASE]);
    if (check.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('PostgreSQL 컨테이너가 준비되지 않았습니다 (60초 초과).');
}

export async function startPostgresFixture({ port = DEFAULT_PORT, log = console.log } = {}) {
  assertDockerAvailable();
  removeContainer();

  const run = docker([
    'run', '--detach', '--rm',
    '--name', CONTAINER,
    '--env', `POSTGRES_PASSWORD=${PASSWORD}`,
    '--env', `POSTGRES_DB=${DATABASE}`,
    '--publish', `127.0.0.1:${port}:5432`,
    IMAGE,
  ]);
  if (run.status !== 0) {
    throw new Error(`PostgreSQL 컨테이너 시작 실패:\n${run.stderr || run.stdout}`);
  }

  log(`[pg] container started: ${CONTAINER} (${IMAGE})`);
  await waitForReady();

  const seed = docker(
    ['exec', '-i', CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DATABASE],
    { input: SEED_SQL },
  );
  if (seed.status !== 0) {
    removeContainer();
    throw new Error(`시드 데이터 적재 실패:\n${seed.stderr || seed.stdout}`);
  }

  const connectionString = `postgresql://postgres:${PASSWORD}@127.0.0.1:${port}/${DATABASE}`;
  log(`[pg] ready: ${connectionString}`);
  log('[pg] seeded table: public.customers (5 rows)');
  return {
    connectionString,
    close: async () => removeContainer(),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const fixture = await startPostgresFixture({});
  const shutdown = async () => {
    console.log('\n[pg] removing container');
    await fixture.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log('[pg] Ctrl+C 로 종료하면 컨테이너가 정리됩니다.');
  // Keep the process alive while the container runs.
  setInterval(() => {}, 60_000);
}
