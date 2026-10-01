import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

export function fixtureRuntime(artifactRoot, { platform = process.platform, tempRoot = tmpdir() } = {}) {
  // Chromium's Unix singleton socket has a short path limit. Keep runtime state
  // out of deep evidence paths; retain the original Windows layout.
  const root = platform === 'win32' ? artifactRoot : mkdtempSync(join(tempRoot, 'ax-ui-'));
  return { root, cleanup() { if (platform !== 'win32') rmSync(root, { recursive: true, force: true }); } };
}

// Start from an allowlist so fixture children cannot inherit provider credentials,
// user configuration or Electron overrides. Display transport is needed on Linux.
export function isolatedFixtureEnv(root, {
  env = process.env, platform = process.platform, homeDir = root, tempDir = root,
  appData = join(root, 'roaming'), localAppData = join(root, 'local'), windowsPath = 'inherit',
} = {}) {
  const result = {
    HOME: homeDir, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir,
    XDG_CONFIG_HOME: join(root, 'xdg-config'), XDG_CACHE_HOME: join(root, 'xdg-cache'),
    XDG_DATA_HOME: join(root, 'xdg-data'), XDG_STATE_HOME: join(root, 'xdg-state'),
  };
  for (const directory of Object.values(result)) mkdirSync(directory, { recursive: true });
  if (platform === 'win32') {
    const systemRoot = env.SystemRoot ?? 'C:\\Windows';
    Object.assign(result, {
      PATH: windowsPath === 'system32' ? win32.join(systemRoot, 'System32') : env.Path ?? env.PATH ?? '',
      SYSTEMROOT: systemRoot, WINDIR: windowsPath === 'system32' ? systemRoot : env.WINDIR ?? systemRoot,
      USERPROFILE: homeDir, APPDATA: appData, LOCALAPPDATA: localAppData,
    });
    mkdirSync(appData, { recursive: true });
    mkdirSync(localAppData, { recursive: true });
  } else {
    result.PATH = env.PATH ?? '/usr/bin:/bin';
    result.LANG = env.LANG ?? 'C.UTF-8';
    for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'LC_ALL']) {
      if (env[key]) result[key] = env[key];
    }
  }
  return result;
}
