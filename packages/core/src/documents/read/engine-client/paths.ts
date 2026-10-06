import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

export interface DocumentEnginePathOptions {
  /**
   * Honor AX_DOCUMENT_ENGINE_WORKER / AX_DOCUMENT_ENGINE_PYTHON. Packaged builds must
   * not let an inherited environment swap the bundled worker or interpreter.
   */
  allowEnvOverrides?: boolean;
}

let hostEnvOverridePolicy: boolean | undefined;

/** The desktop host passes `!app.isPackaged`; `undefined` restores the built-in detection. */
export function setDocumentEngineEnvOverridesAllowed(allowed: boolean | undefined): void {
  hostEnvOverridePolicy = allowed;
}

function looksPackaged(): boolean {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return Boolean(resourcesPath && existsSync(join(resourcesPath, 'app.asar')));
}

/** Explicit option, then the host policy, then: allowed unless this is a packaged app. */
export function documentEngineEnvOverridesAllowed(options: DocumentEnginePathOptions = {}): boolean {
  if (options.allowEnvOverrides !== undefined) return options.allowEnvOverrides;
  if (hostEnvOverridePolicy !== undefined) return hostEnvOverridePolicy;
  return !looksPackaged();
}

/** Walk from bundled Electron main and cwd — import.meta.url is not the source tree after vite bundle. */
export function defaultWorkerScript(options: DocumentEnginePathOptions = {}): string {
  const fromEnv = documentEngineEnvOverridesAllowed(options) ? process.env.AX_DOCUMENT_ENGINE_WORKER : undefined;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = join(resourcesPath, 'document-engine', 'src', 'worker.py');
    if (existsSync(bundled)) return bundled;
    if (existsSync(join(resourcesPath, 'app.asar'))) {
      throw new Error('Packaged document-engine worker is missing: ' + bundled);
    }
  }

  return (
    findUp(moduleDir(), WORKER_REL) ??
    findUp(process.cwd(), WORKER_REL) ??
    join(moduleDir(), '../../../document-engine/src/worker.py')
  );
}

export function defaultPythonPath(
  workerScript?: string,
  options: DocumentEnginePathOptions = {},
): string {
  workerScript ??= defaultWorkerScript(options);
  const fromEnv = documentEngineEnvOverridesAllowed(options) ? process.env.AX_DOCUMENT_ENGINE_PYTHON : undefined;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const engineRoot = dirname(dirname(workerScript));
  const bundledPython = process.platform === 'win32'
    ? join(engineRoot, 'python', 'python.exe')
    : join(engineRoot, 'python', 'bin', 'python3');
  if (existsSync(bundledPython)) return bundledPython;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath && resolve(workerScript) === resolve(join(resourcesPath, 'document-engine', 'src', 'worker.py'))) {
    throw new Error('Packaged document-engine Python is missing: ' + bundledPython);
  }
  const venvPython = pythonInVenv(engineRoot);
  if (existsSync(venvPython)) return venvPython;

  return process.platform === 'win32' ? 'python' : 'python3';
}

export function defaultWorkerCwd(workerScript: string): string {
  return dirname(workerScript);
}
