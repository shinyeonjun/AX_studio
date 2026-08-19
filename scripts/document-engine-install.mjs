import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const venvDir = join(root, 'packages', 'document-engine', '.venv');
const python =
  process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python');

if (!existsSync(python)) {
  console.error('Missing venv. Run: npm run document-engine:setup');
  process.exit(1);
}

const pip = [python, '-m', 'pip', 'install', '-r', join(root, 'packages', 'document-engine', 'requirements.txt')];
execFileSync(pip[0], pip.slice(1), {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, PYTHONUTF8: '1' },
});
