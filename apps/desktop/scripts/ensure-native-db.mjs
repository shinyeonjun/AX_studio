import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(scriptDir, '..');
const repositoryRoot = join(desktopRoot, '..', '..');

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

function hasUsableNativeBinding(pkgDir) {
  try {
    const Database = require(pkgDir);
    const database = new Database(':memory:');
    try {
      database.prepare('SELECT 1').get();
      return true;
    } finally {
      database.close();
    }
  } catch {
    return false;
  }
}

function runNativeBuild(pkgDir, version) {
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [repositoryRoot] });
  return spawnSync(process.execPath, [
    nodeGyp,
    'rebuild',
    '--release',
    '--runtime=electron',
    `--target=${version}`,
    '--dist-url=https://electronjs.org/headers',
  ], {
    cwd: pkgDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const pkgDir = resolveBetterSqlite3Dir();
const binary = nativeBinaryPath(pkgDir);
const version = electronVersion();
const unavailableMarker = join(pkgDir, '.ax-native-db-unavailable');
const nativeFingerprint = `${version}:${betterSqliteVersion(pkgDir)}:${process.platform}:${process.arch}`;
const nativeBuildOptIn = process.env.AX_NATIVE_DB_BUILD === '1';

function betterSqliteVersion(pkgDir) {
  try {
    return require(require.resolve('better-sqlite3/package.json', { paths: [pkgDir] })).version;
  } catch {
    return 'unknown';
  }
}

function unavailableWasRecorded() {
  try {
    return readFileSync(unavailableMarker, 'utf8').trim() === nativeFingerprint;
  } catch {
    return false;
  }
}

function recordUnavailable() {
  writeFileSync(unavailableMarker, `${nativeFingerprint}\n`, 'utf8');
}

if (!existsSync(pkgDir)) {
  console.warn('[native-db] better-sqlite3 package not found; skipping native DB setup');
  process.exit(0);
}

if (hasUsableNativeBinding(pkgDir)) {
  rmSync(unavailableMarker, { force: true });
  console.log('[native-db] compatible better-sqlite3 binding already available');
  process.exit(0);
}

if (!existsSync(binary) && unavailableWasRecorded() && !nativeBuildOptIn) {
  console.log(`[native-db] no compatible native SQLite binding cached for Electron ${version}; using sql.js`);
  process.exit(0);
}

const staleBinary = `${binary}.stale`;
if (existsSync(binary)) {
  rmSync(staleBinary, { force: true });
  renameSync(binary, staleBinary);
}
if (!nativeBuildOptIn) {
  recordUnavailable();
  console.warn('[native-db] compatible better-sqlite3 prebuild unavailable; desktop will use sql.js. Set AX_NATIVE_DB_BUILD=1 to try a local build.');
  process.exit(0);
}

console.log(`[native-db] building better-sqlite3 for Electron ${version}...`);
const result = runNativeBuild(pkgDir, version);
const ready = result.status === 0 && existsSync(binary) && hasUsableNativeBinding(pkgDir);
if (!ready) {
  console.warn('[native-db] local Electron-targeted native build failed');
}

if (!ready) {
  rmSync(binary, { force: true });
  rmSync(staleBinary, { force: true });
  recordUnavailable();
  console.warn('[native-db] Electron native build unavailable; desktop will fall back to sql.js');
  process.exit(0);
}

rmSync(staleBinary, { force: true });
rmSync(unavailableMarker, { force: true });
console.log(`[native-db] better-sqlite3 ready for Electron ${version}`);
