import { createHash } from 'node:crypto';
import { cpSync } from 'node:fs';
import { join } from 'node:path';

// Deliberately native-only. macOS, ARM and musl need their own reviewed runtimes.
export function packagePlatform(platform = process.platform, arch = process.arch) {
  if (arch !== 'x64' || !['win32', 'linux'].includes(platform)) {
    throw new Error(`Packaging supports native Windows x64 and Linux glibc x64 only (received ${platform}/${arch}).`);
  }
  return platform === 'win32'
    ? { platform, arch, builderFlag: '--win', unpacked: 'win-unpacked', executable: 'AX Studio.exe',
      python: 'python/python.exe', sitePackages: 'python/Lib/site-packages', pythonLicense: 'python/LICENSE.txt' }
    : { platform, arch, builderFlag: '--linux', unpacked: 'linux-unpacked', executable: 'ax-studio',
      python: 'python/bin/python3', sitePackages: 'python/lib/python3.13/site-packages',
      pythonLicense: 'python/lib/python3.13/LICENSE.txt' };
}

const linuxRelease = 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/';
export const pythonRuntimes = Object.freeze({
  win32: Object.freeze({
    version: '3.13.15', source: 'CPython official embeddable distribution',
    url: 'https://www.python.org/ftp/python/3.13.15/python-3.13.15-embed-amd64.zip',
    sha256: 'd1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf',
  }),
  linux: Object.freeze({
    version: '3.13.15', source: 'Astral python-build-standalone 20260901 (GIL-enabled, glibc x64)',
    url: linuxRelease + 'cpython-3.13.15%2B20260901-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
    sha256: '8a689a077337bea6d1c4bc0b7df1d52fcaa28f5f67e50df8bf417c1e3f9d8874',
    // install_only omits full-archive metadata and dependency license texts.
    // Retain those from the matching full build, without shipping build objects.
    noticesUrl: linuxRelease + 'cpython-3.13.15%2B20260901-x86_64-unknown-linux-gnu-pgo%2Blto-full.tar.zst',
    noticesSha256: '9d57bd835f5663e7947cfb4428ec8decbd9f3d7141c40eb413fad4096f82a819',
  }),
});

export function verifyArchiveBytes(bytes, expectedHash) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedHash) throw new Error(`Python archive checksum mismatch (expected ${expectedHash}, received ${actual}).`);
  return actual;
}

export function packagePaths(directory, platform = process.platform, arch = process.arch) {
  const layout = packagePlatform(platform, arch);
  return { ...layout, executablePath: join(directory, layout.executable), archive: join(directory, 'resources', 'app.asar'),
    bundle: join(directory, 'resources', 'document-engine') };
}

export function isolatedPythonEnv(scratch, env = process.env, platform = process.platform) {
  const result = { TEMP: scratch, TMP: scratch, TMPDIR: scratch, HOME: scratch,
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1' };
  if (platform === 'win32' && env.SystemRoot) result.SystemRoot = env.SystemRoot;
  return result;
}

export function isolatedAppEnv(scratch, env = process.env) {
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (key.startsWith('AX_') || key.startsWith('PYTHON') || key === 'ELECTRON_RUN_AS_NODE' ||
      key === 'ELECTRON_RENDERER_URL' || /(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET)$/.test(key)) delete result[key];
  }
  return { ...result, HOME: scratch, XDG_CONFIG_HOME: join(scratch, 'config'), XDG_DATA_HOME: join(scratch, 'xdg-data'),
    AX_DATA_ROOT: join(scratch, 'data'), AX_E2E: '1', AX_E2E_FAKE_AGENT: '1' };
}

export function parsePackageArgs(args, host = process.platform, arch = process.arch) {
  let platform = host;
  let directoryOnly = false;
  let skipUi = false;
  for (const arg of args) {
    if (arg === '--dir') directoryOnly = true;
    else if (arg === '--skip-ui') skipUi = true;
    else if (arg.startsWith('--platform=')) platform = arg.slice('--platform='.length);
    else throw new Error(`Unknown packaging argument: ${arg}`);
  }
  const layout = packagePlatform(platform, arch);
  if (platform !== host) throw new Error(`Build on the target platform; cross-packaging ${host} -> ${platform} is unsupported.`);
  return { ...layout, directoryOnly, skipUi };
}

// Node otherwise rewrites relative symlinks to absolute staging paths.
export function copyBundle(source, target) {
  // Node 22's native recursive copy mishandles Unicode Windows paths.
  // An all-inclusive filter uses the Unicode-safe JS path (nodejs/node#61878).
  cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true, filter: () => true });
}

export function assertNativeBuildHost(layout, host = {}) {
  const platform = host.platform ?? process.platform;
  const arch = host.arch ?? process.arch;
  if (layout.platform !== platform || layout.arch !== arch) throw new Error('Build on the matching native platform and architecture.');
  const glibcVersion = Object.hasOwn(host, 'glibcVersion') ? host.glibcVersion
    : platform === 'linux' ? process.report.getReport().header.glibcVersionRuntime : undefined;
  if (platform === 'linux' && !glibcVersion) throw new Error('Linux packaging requires glibc; musl/Alpine is unsupported.');
}
