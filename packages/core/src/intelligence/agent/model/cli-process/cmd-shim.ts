import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve, sep } from 'node:path';

export interface CmdShimRuntime {
  node: string;
  script: string;
  /** True when the host Electron binary must act as Node. */
  electronAsNode: boolean;
}

export function isCmdShim(command: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

/** npm cmd-shim writes `"%dp0%\node_modules\...\cli.js" %*` (older releases: `%~dp0`). */
export function parseCmdShimScript(content: string): string | null {
  const match = content.match(/"%(?:dp0%|~dp0)\\?([^"%]+?\.[cm]?js)"/i);
  return match?.[1] ?? null;
}

function nodeOnPath(): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'node.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveCmdShim(command: string): CmdShimRuntime | null {
  let content: string;
  try { content = readFileSync(command, 'utf8'); } catch { return null; }
  const relative = parseCmdShimScript(content);
  if (!relative) return null;
  const dir = dirname(command);
  const script = resolve(dir, relative.replace(/\\/g, sep));
  // Never follow a shim outside its own install directory.
  if (!script.toLowerCase().startsWith(`${dir.toLowerCase()}${sep}`) || !existsSync(script)) return null;
  const localNode = join(dir, 'node.exe');
  if (existsSync(localNode)) return { node: localNode, script, electronAsNode: false };
  const pathNode = nodeOnPath();
  if (pathNode) return { node: pathNode, script, electronAsNode: false };
  return { node: process.execPath, script, electronAsNode: Boolean(process.versions.electron) };
}
