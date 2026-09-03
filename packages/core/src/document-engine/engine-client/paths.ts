import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

const WORKER_REL = join('packages', 'document-engine', 'src', 'worker.py');

function findUp(start: string, relativePath: string, maxHops = 10): string | undefined {
  let dir = start;
  for (let i = 0; i < maxHops; i += 1) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function pythonInVenv(engineRoot: string): string {
  return process.platform === 'win32'
    ? join(engineRoot, '.venv', 'Scripts', 'python.exe')
    : join(engineRoot, '.venv', 'bin', 'python');
}

/** Walk from bundled Electron main and cwd — import.meta.url is not the source tree after vite bundle. */
export function defaultWorkerScript(): string {
  const fromEnv = process.env.AX_DOCUMENT_ENGINE_WORKER;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  return (
    findUp(moduleDir(), WORKER_REL) ??
    findUp(process.cwd(), WORKER_REL) ??
    join(moduleDir(), '../../../document-engine/src/worker.py')
  );
}

export function defaultPythonPath(workerScript = defaultWorkerScript()): string {
  const fromEnv = process.env.AX_DOCUMENT_ENGINE_PYTHON;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const engineRoot = dirname(dirname(workerScript));
  const venvPython = pythonInVenv(engineRoot);
  if (existsSync(venvPython)) return venvPython;

  return process.platform === 'win32' ? 'python' : 'python3';
}

export function defaultWorkerCwd(workerScript: string): string {
  return dirname(workerScript);
}
