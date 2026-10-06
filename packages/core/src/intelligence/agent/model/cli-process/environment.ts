import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { CommandInvocation } from './contracts.js';
import { isCmdShim, resolveCmdShim } from './cmd-shim.js';

export function extraBinDirs(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [
      process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
      join(home, 'AppData', 'Roaming', 'npm'),
      join(home, '.local', 'bin'),
      join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
    ].filter(Boolean);
  }
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
  ];
}

/** PATH is rebuilt separately; proxy/CA variables keep CLIs working behind corporate networks. */
const INHERITED_ENV_KEYS = new Set([
  'APPDATA', 'COMSPEC', 'CODEX_HOME', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'LANG', 'LOCALAPPDATA', 'NO_COLOR', 'PATHEXT', 'SYSTEMDRIVE',
  'SYSTEMROOT', 'TEMP', 'TERM', 'TMP', 'USERPROFILE', 'WINDIR',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS',
]);

function isInheritedEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (upper === 'PATH') return false;
  if (!INHERITED_ENV_KEYS.has(upper)) return key.startsWith('LC_');
  // Windows keys are case-insensitive (`SystemRoot`, `windir`); proxies are often lower-case.
  return process.platform === 'win32' || key === upper || upper.endsWith('_PROXY');
}

export function commandEnv(): NodeJS.ProcessEnv {
  const extra = extraBinDirs().join(delimiter);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => isInheritedEnvKey(key)),
  );
  return {
    ...inherited,
    PATH: extra ? `${extra}${delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
  };
}

/**
 * Node refuses to spawn .cmd/.bat without a shell (CVE-2024-27980), and a shell would
 * re-parse model ids and prompts. npm shims are therefore run as `node <entry.js>`.
 */
export function commandInvocation(command: string, args: string[]): CommandInvocation {
  const env = commandEnv();
  if (!isCmdShim(command)) return { file: command, args, env };
  const shim = resolveCmdShim(command);
  if (!shim) {
    throw Object.assign(
      new Error(`Cannot run ${command} without a shell. Reinstall the CLI with npm or use its .exe build.`),
      { code: 'EUNSUPPORTEDSHIM' },
    );
  }
  return {
    file: shim.node,
    args: [shim.script, ...args],
    env: shim.electronAsNode ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env,
  };
}
