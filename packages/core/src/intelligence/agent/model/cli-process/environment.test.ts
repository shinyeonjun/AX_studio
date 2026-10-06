import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandEnv, commandInvocation } from './environment.js';
import { runCommand } from './runner/exec.js';

describe('CLI process environment', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('passes proxy and CA settings but not unrelated secrets', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080');
    vi.stubEnv('no_proxy', 'localhost');
    vi.stubEnv('NODE_EXTRA_CA_CERTS', '/etc/ca.pem');
    vi.stubEnv('AX_SYNTHETIC_SECRET', 'do-not-pass');
    const env = commandEnv();
    expect(env.HTTPS_PROXY).toBe('http://proxy.example:8080');
    expect(env.no_proxy).toBe('localhost');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/ca.pem');
    expect(env.AX_SYNTHETIC_SECRET).toBeUndefined();
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH']);
  });

  it.skipIf(process.platform !== 'win32')('runs an npm .cmd shim through node without a shell', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ax-shim-run-'));
    try {
      const script = join(dir, 'node_modules', 'fake-cli', 'cli.js');
      await mkdir(join(script, '..'), { recursive: true });
      await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
      const shim = join(dir, 'fake.cmd');
      await writeFile(shim, '@ECHO off\r\n"%~dp0\\node.exe"  "%~dp0\\node_modules\\fake-cli\\cli.js" %*\r\n');
      const args = ['--model', 'a&b|c', '"quoted" %PATH%'];
      expect(commandInvocation(shim, args).args).toEqual([script, ...args]);
      const result = await runCommand(shim, args, { timeoutMs: 10_000 });
      expect(JSON.parse(result.stdout)).toEqual(args);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('rejects an unknown .cmd instead of invoking cmd.exe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ax-shim-bad-'));
    try {
      const shim = join(dir, 'custom.cmd');
      await writeFile(shim, '@echo off\r\necho hi\r\n');
      await expect(runCommand(shim, [])).rejects.toMatchObject({ code: 'EUNSUPPORTEDSHIM' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
