import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
    // A missing Electron prebuild is the normal fallback path. Keep npm's
    // download/deprecation noise out of the dev-server output; an explicit
    // native build request still gets full diagnostics below.
    stdio: process.env.AX_NATIVE_DB_BUILD === '1' ? 'inherit' : 'ignore',
    shell: process.platform === 'win32',
  });
}

function runNativeBuild(pkgDir, version) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnSync(npx, [
    'node-gyp',
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
const versionMarker = join(pkgDir, '.ax-electron-version');
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

if (existsSync(binary) && existsSync(versionMarker) && readFileSync(versionMarker, 'utf8').trim() === version) {
  rmSync(unavailableMarker, { force: true });
  console.log('[native-db] better-sqlite3 binary already present');
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
console.log(`[native-db] downloading better-sqlite3 prebuild for Electron ${version}...`);
const result = runPrebuildInstall(pkgDir, version);

let ready = result.status === 0 && existsSync(binary);
if (!ready && nativeBuildOptIn) {
  console.warn('[native-db] prebuild unavailable; trying an Electron-targeted local build');
  const build = runNativeBuild(pkgDir, version);
  ready = build.status === 0 && existsSync(binary);
}

if (!ready) {
  rmSync(binary, { force: true });
  rmSync(staleBinary, { force: true });
  rmSync(versionMarker, { force: true });
  recordUnavailable();
  if (nativeBuildOptIn) {
    console.warn('[native-db] Electron native build unavailable; desktop will fall back to sql.js');
  } else {
    console.warn(`[native-db] no prebuilt better-sqlite3 binding for Electron ${version}; desktop will use sql.js. Set AX_NATIVE_DB_BUILD=1 to try a local native build.`);
  }
  process.exit(0);
}

rmSync(staleBinary, { force: true });
rmSync(unavailableMarker, { force: true });
writeFileSync(versionMarker, `${version}\n`, 'utf8');
console.log(`[native-db] better-sqlite3 ready for Electron ${version}`);
