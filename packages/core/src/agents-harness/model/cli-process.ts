import { execFile, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandInvocation {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export function extraBinDirs(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [
      process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
      join(home, 'AppData', 'Roaming', 'npm'),
      join(home, '.local', 'bin'),
      join(localAppData, 'cursor-agent'),
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

/** agent.cmd wrapper → bundled node.exe + index.js. Avoid cmd.exe for Unicode prompts. */
export function resolveCmdNodeRuntime(command: string): { file: string; script: string } | null {
  if (process.platform !== 'win32' || !/\.cmd$/i.test(command)) return null;
  const dir = dirname(command);
  const localNode = join(dir, 'node.exe');
  const localScript = join(dir, 'index.js');
  if (existsSync(localNode) && existsSync(localScript)) {
    return { file: localNode, script: localScript };
  }
  const versionsDir = join(dir, 'versions');
  if (!existsSync(versionsDir)) return null;
  const names = readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}\.\d{1,2}\.\d{1,2}/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of names) {
    const file = join(versionsDir, name, 'node.exe');
    const script = join(versionsDir, name, 'index.js');
    if (existsSync(file) && existsSync(script)) return { file, script };
  }
  return null;
}

export function commandInvocation(command: string, args: string[]): CommandInvocation {
  const runtime = resolveCmdNodeRuntime(command);
  if (runtime) {
    return {
      file: runtime.file,
      args: [runtime.script, ...args],
      env: { ...commandEnv(), CURSOR_INVOKED_AS: 'agent.cmd' },
    };
  }
  return { file: command, args, env: commandEnv() };
}

export function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number; input?: string; cwd?: string } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const invocation = commandInvocation(command, args);

  return new Promise((resolve, reject) => {
    const child = execFile(
      invocation.file,
      invocation.args,
      {
        env: invocation.env,
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
