import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const command = process.platform === 'win32'
  ? (process.env.ComSpec ?? 'cmd.exe')
  : npmCommand;
const isPoc = process.argv.includes('--poc') || process.env.AX_ASSISTANT_UI_POC === '1';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm run dev:raw']
  : ['run', 'dev:raw'];

const child = spawn(command, args, {
  cwd: fileURLToPath(new URL('../apps/desktop/', import.meta.url)),
  // The app's own dev data root (%LOCALAPPDATA%\AXStudio-dev on Windows) unless AX_DATA_ROOT is
  // set. Not the OS temp directory: Windows Storage Sense deletes old files there.
  env: {
    ...process.env,
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
