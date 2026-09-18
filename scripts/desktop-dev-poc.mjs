import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const command = process.platform === 'win32'
  ? (process.env.ComSpec ?? 'cmd.exe')
  : npmCommand;
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryName = basename(repositoryRoot).replace(/[^a-zA-Z0-9._-]+/g, '-');
const isolatedDataRoot = join(tmpdir(), `AXStudio-${repositoryName}`);
const isPoc = process.argv.includes('--poc') || process.env.AX_ASSISTANT_UI_POC === '1';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm run dev:raw']
  : ['run', 'dev:raw'];

const child = spawn(command, args, {
  cwd: fileURLToPath(new URL('../apps/desktop/', import.meta.url)),
  env: {
    ...process.env,
    AX_DATA_ROOT: process.env.AX_DATA_ROOT?.trim() || isolatedDataRoot,
    ...(isPoc ? { AX_ASSISTANT_UI_POC: '1' } : {}),
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('[AX Studio] assistant-ui PoC 실행 실패:', error.message);
  process.exit(1);
});
