import { execFile, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function extraBinDirs(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [
      process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
      join(home, 'AppData', 'Roaming', 'npm'),
      join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
      join(localAppData, 'Programs', 'cursor', 'resources', 'app', 'bin'),
    ].filter(Boolean);
  }
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
  ];
}

export function commandEnv(): NodeJS.ProcessEnv {
  const extra = extraBinDirs().join(delimiter);
  return {
    ...process.env,
    PATH: extra ? `${extra}${delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
  };
}

function resolveBinaryViaWhere(name: string): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const output = execSync(`where.exe ${name}`, {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate && existsSync(candidate)) return candidate;
    }
  } catch {
    // not found
  }
  return null;
}

export function resolveBinary(names: readonly string[]): string | null {
  const dirs = [...extraBinDirs(), ...(process.env.PATH ?? '').split(delimiter)];
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const name of names) {
    for (const dir of dirs) {
      if (!dir) continue;
      for (const suffix of suffixes) {
        const candidate = join(dir, `${name}${suffix}`);
        if (existsSync(candidate)) return candidate;
      }
    }
    const viaWhere = resolveBinaryViaWhere(name);
    if (viaWhere) return viaWhere;
  }
  return null;
}

export function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number; input?: string; cwd?: string } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const useCmd = process.platform === 'win32' && /\.cmd$/i.test(command);
  const file = useCmd ? process.env.ComSpec || 'cmd.exe' : command;
  const fileArgs = useCmd ? ['/d', '/s', '/c', `"${command}"`, ...args] : args;

  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      fileArgs,
      {
        env: commandEnv(),
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        cwd: options.cwd,
      },
      (error, stdout, stderr) => {
        const code = error && 'code' in error ? error.code : 0;
        const exitCode = typeof code === 'number' ? code : error ? 1 : 0;
        if (error && code === 'ETIMEDOUT') {
          reject(error);
          return;
        }
        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          exitCode: error ? exitCode || 1 : 0,
        });
      },
    );
    if (options.input) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }
  });
}
