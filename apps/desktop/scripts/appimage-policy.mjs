import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ownedAppRun = resolve(import.meta.dirname, '../build/AppRun');
export function installOwnedAppRun(context) {
  if (context.electronPlatformName !== 'linux') return;
  const target = join(context.appOutDir, 'AppRun');
  copyFileSync(ownedAppRun, target);
  chmodSync(target, 0o755);
}

export function assertAppImagePolicy(directory) {
  const expected = readFileSync(ownedAppRun);
  const launcher = join(directory, 'AppRun');
  const metadata = lstatSync(launcher);
  if (!metadata.isFile() || (process.platform !== 'win32' && !(metadata.mode & 0o111))) {
    throw new Error('AppImage launcher must be a regular executable file.');
  }
  const actual = readFileSync(launcher);
  const hash = data => createHash('sha256').update(data).digest('hex');
  if (hash(actual) !== hash(expected)) throw new Error('AppImage launcher differs from the reviewed project-owned AppRun. Stock launcher fallback is forbidden.');
  const desktopFiles = readdirSync(directory).filter(name => name.endsWith('.desktop'));
  if (desktopFiles.length !== 1) throw new Error('Expected exactly one AppImage desktop entry');
  const desktop = readFileSync(join(directory, desktopFiles[0]), 'utf8');
  const exec = desktop.split(/\r?\n/).find(line => line.startsWith('Exec='));
  if (!exec || !/^Exec=AppRun(?:\s|$)/.test(exec) || /--(?:no-sandbox|disable-\S*sandbox)/.test(exec)) {
    throw new Error('AppImage desktop entry must use AppRun without sandbox-disabling flags.');
  }
  return { launcherSha256: hash(actual), desktopEntry: desktopFiles[0], exec };
}

export function verifyAppImagePolicy(artifact) {
  const scratch = mkdtempSync(join(tmpdir(), 'ax-appimage-policy-'));
  try {
    // Official extraction operation only. It does not start Electron or AppRun.
    execFileSync(resolve(artifact), ['--appimage-extract'], { cwd: scratch, stdio: 'ignore', timeout: 180_000 });
    const evidence = assertAppImagePolicy(join(scratch, 'squashfs-root'));
    console.log('AppImage launcher policy: reviewed fail-closed AppRun and desktop entry verified. ' + JSON.stringify(evidence));
    return evidence;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
