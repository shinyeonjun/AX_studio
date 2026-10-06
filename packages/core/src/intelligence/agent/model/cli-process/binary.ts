import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { extraBinDirs } from './environment.js';

const CACHE_TTL_MS = 30_000;

interface Cached { value: string | null; at: number }

const resolved = new Map<string, Cached>();
const whereResults = new Map<string, Cached>();
const whereLookups = new Map<string, Promise<string | null>>();

function fresh(entry: Cached | undefined): entry is Cached {
  return Boolean(entry && Date.now() - entry.at < CACHE_TTL_MS);
}

function scanDirectories(names: readonly string[]): string | null {
  const dirs = [...extraBinDirs(), ...(process.env.PATH ?? '').split(delimiter)];
  // Prefer native executables; npm .cmd shims are unwrapped by commandInvocation.
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const name of names) {
    for (const dir of dirs) {
      if (!dir) continue;
      for (const suffix of suffixes) {
        const candidate = join(dir, `${name}${suffix}`);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function lookupWhere(name: string): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const pending = whereLookups.get(name);
  if (pending) return pending;
  const lookup = new Promise<string | null>((resolveLookup) => {
    execFile('where.exe', [name], { encoding: 'utf8', timeout: 4_000, windowsHide: true }, (error, stdout) => {
      const lines = error ? [] : stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      resolveLookup(lines.find((line) => /\.(exe|cmd|bat)$/i.test(line) && existsSync(line)) ?? null);
    });
  }).then((value) => {
    whereResults.set(name, { value, at: Date.now() });
    whereLookups.delete(name);
    // A late where.exe answer must be visible to the next synchronous lookup.
    if (value) resolved.clear();
    return value;
  });
  whereLookups.set(name, lookup);
  return lookup;
}

/**
 * Synchronous, cached lookup that is safe on hot paths such as state snapshots.
 * `where.exe` never blocks here: it refreshes in the background for a later call.
 */
export function resolveBinary(names: readonly string[]): string | null {
  const key = names.join('\0');
  const cached = resolved.get(key);
  if (fresh(cached)) return cached.value;
  let value = scanDirectories(names);
  for (const name of value ? [] : names) {
    const where = whereResults.get(name);
    if (!fresh(where)) void lookupWhere(name);
    if (where?.value && existsSync(where.value)) { value = where.value; break; }
  }
  resolved.set(key, { value, at: Date.now() });
  return value;
}

/** Lookup that waits for `where.exe`; used by explicit detection and CLI execution. */
export async function resolveBinaryAsync(names: readonly string[]): Promise<string | null> {
  let value = scanDirectories(names);
  for (const name of value ? [] : names) {
    const where = whereResults.get(name);
    value = fresh(where) ? where.value : await lookupWhere(name);
    if (value) break;
  }
  resolved.set(names.join('\0'), { value, at: Date.now() });
  return value;
}

export function invalidateBinaryCache(): void {
  resolved.clear();
  whereResults.clear();
}
