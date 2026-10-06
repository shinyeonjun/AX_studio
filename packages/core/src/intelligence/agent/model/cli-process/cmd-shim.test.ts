import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCmdShim, parseCmdShimScript, resolveCmdShim } from './cmd-shim.js';

/** Verbatim layout written by npm's cmd-shim for a global package bin. */
const NPM_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  '',
].join('\r\n');

describe('npm .cmd shim unwrapping', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ax-shim-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('parses current and legacy npm shim entry points', () => {
    expect(parseCmdShimScript(NPM_SHIM)).toBe('node_modules\\@anthropic-ai\\claude-code\\cli.js');
    expect(parseCmdShimScript('"%~dp0\\node.exe"  "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*'))
      .toBe('node_modules\\@openai\\codex\\bin\\codex.js');
    expect(parseCmdShimScript('@echo off\r\ncall "C:\\tools\\real.exe" %*')).toBeNull();
  });

  it('resolves a shim to node plus its JS entry without a shell', async () => {
    const script = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    await mkdir(join(script, '..'), { recursive: true });
    await writeFile(script, '');
    await writeFile(join(dir, 'claude.cmd'), NPM_SHIM);
    await writeFile(join(dir, 'node.exe'), '');
    expect(resolveCmdShim(join(dir, 'claude.cmd'))).toEqual({
      node: join(dir, 'node.exe'), script, electronAsNode: false,
    });
  });

  it('refuses shims whose entry escapes the install directory or is missing', async () => {
    await writeFile(join(dir, 'evil.cmd'), '"%dp0%\\..\\outside.js" %*');
    await writeFile(join(dir, 'missing.cmd'), '"%dp0%\\node_modules\\x\\cli.js" %*');
    expect(resolveCmdShim(join(dir, 'evil.cmd'))).toBeNull();
    expect(resolveCmdShim(join(dir, 'missing.cmd'))).toBeNull();
  });

  it('only treats .cmd/.bat as shims on Windows', () => {
    expect(isCmdShim('C:\\npm\\codex.cmd', 'win32')).toBe(true);
    expect(isCmdShim('C:\\npm\\codex.BAT', 'win32')).toBe(true);
    expect(isCmdShim('C:\\npm\\codex.exe', 'win32')).toBe(false);
    expect(isCmdShim('/usr/bin/codex.cmd', 'linux')).toBe(false);
  });
});
