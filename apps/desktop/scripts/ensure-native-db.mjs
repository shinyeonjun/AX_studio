import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(scriptDir, '..');

function resolveBetterSqlite3Dir() {
  try {
    return dirname(require.resolve('better-sqlite3/package.json', { paths: [desktopRoot] }));
  } catch {
    return join(desktopRoot, '..', '..', 'node_modules', 'better-sqlite3');
  }
}

function electronVersion() {
  return require(require.resolve('electron/package.json', { paths: [desktopRoot] })).version;
}

function nativeBinaryPath(pkgDir) {
  return join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
}

function runPrebuildInstall(pkgDir, version) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnSync(npx, ['prebuild-install', '--runtime', 'electron', '--target', version], {
    cwd: pkgDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const pkgDir = resolveBetterSqlite3Dir();
const binary = nativeBinaryPath(pkgDir);

if (!existsSync(pkgDir)) {
  console.warn('[native-db] better-sqlite3 package not found; skipping native DB setup');
  process.exit(0);
}

if (existsSync(binary)) {
  console.log('[native-db] better-sqlite3 binary already present');
  process.exit(0);
}

const version = electronVersion();
console.log(`[native-db] downloading better-sqlite3 prebuild for Electron ${version}...`);
const result = runPrebuildInstall(pkgDir, version);

if (result.status !== 0 || !existsSync(binary)) {
  console.warn(
    '[native-db] better-sqlite3 prebuild unavailable; desktop will fall back to sql.js until native DB is installed',
  );
  process.exit(0);
}

console.log(`[native-db] better-sqlite3 ready for Electron ${version}`);
