import {
  BRAND_CLI_PROVIDER,
  CLI_PROVIDER_META,
  resolveBinaryAsync,
  runCommand,
  type AiBrand,
} from '@ax-studio/core';

export async function testAiCli(brand: AiBrand): Promise<{ ok: true; command: string; version?: string }> {
  const meta = CLI_PROVIDER_META[BRAND_CLI_PROVIDER[brand]];
  const command = await resolveBinaryAsync(meta.binaries);
  if (!command) {
    throw new Error(`${meta.label} CLI를 찾을 수 없습니다. PATH 또는 설치 경로를 확인하세요.`);
  }

  const result = await runCommand(command, ['--version'], { timeoutMs: 8000 });
  const versionText = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0]?.trim();
  if (result.exitCode !== 0 && !versionText) {
    throw new Error(result.stderr.trim().slice(0, 2_048) || `${meta.label} CLI 실행에 실패했습니다.`);
  }

  return { ok: true, command, version: versionText || undefined };
}
