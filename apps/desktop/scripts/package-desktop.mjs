import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { verifyAppImagePolicy } from './appimage-policy.mjs';
import { assertNativeBuildHost, parsePackageArgs } from '../../../scripts/lib/package-platform.mjs';

const root = join(import.meta.dirname, '..', '..', '..');
const require = createRequire(import.meta.url);
if (process.argv.includes('--help')) {
  console.log('Native Windows/Linux x64 packaging: [--dir] [--platform=win32|linux] [--skip-ui]\n--skip-ui runs archive, license and relocated PDF checks, but explicitly leaves graphical acceptance unverified. Nothing is published.');
  process.exit(0);
}
const options = parsePackageArgs(process.argv.slice(2));
assertNativeBuildHost(options);
function run(label, command, args, cwd = root) {
  console.log(`\n[package] ${label}`);
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: 'inherit', windowsHide: true,
    shell: process.platform === 'win32' && command === 'npm' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// Always build core too: a fresh checkout has no core/dist for electron-vite.
run('Build core and desktop', 'npm', ['run', 'build']);
run('Prepare isolated Python payload', process.execPath, [join(root, 'scripts/document-engine-install.mjs'), '--bundle']);
run('Install official Electron distribution', process.execPath, [require.resolve('electron/install.js')]);
run('Build native desktop package (publishing disabled)', process.execPath,
  [require.resolve('electron-builder/cli.js'), options.builderFlag, '--x64', '--publish', 'never', ...(options.directoryOnly ? ['--dir'] : [])],
  join(root, 'apps/desktop'));
if (options.platform === 'linux' && !options.directoryOnly) {
  const { version } = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
  verifyAppImagePolicy(join(root, `apps/desktop/release/AX Studio-${version}.AppImage`));
}
run('Verify packaged archive and document payload', process.execPath,
  [join(root, 'scripts/document-engine-install.mjs'), '--verify-package', join(root, 'apps/desktop/release', options.unpacked),
    ...(options.skipUi ? ['--skip-ui'] : [])]);
console.log(`[package] Built ${options.platform}/${options.arch}; UI ${options.skipUi ? 'NOT VERIFIED (--skip-ui)' : 'verified'}. No release was published.`);
