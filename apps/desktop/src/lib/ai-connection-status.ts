import type { DetectedAiCli } from '../types/ai-provider';

export interface GrokConnectionParts {
  cliFound: boolean;
  apiKeyReady: boolean;
  ready: boolean;
  cliPath?: string;
  cliVersion?: string;
}

export function assessGrokConnection(
  cliOption: DetectedAiCli | undefined,
  apiKeyConfigured: boolean,
  cliVerified: boolean,
): GrokConnectionParts {
  const cliFound = Boolean(cliOption?.binaryFound ?? cliOption?.command);
  const apiKeyReady = apiKeyConfigured;
  const cliReady = Boolean(cliOption?.installed || (cliFound && cliVerified));
  const version = cliOption?.version?.match(/\d{4}\.\d{1,2}\.\d{1,2}(?:-[a-z0-9.-]+)?/i)?.[0];
  return {
    cliFound,
    apiKeyReady,
    ready: cliReady && apiKeyReady,
    cliPath: cliOption?.command,
    cliVersion: version,
  };
}

export function grokConnectionGuide(parts: GrokConnectionParts): string {
  if (parts.ready) {
    return parts.cliVersion
      ? `agent CLI ${parts.cliVersion}와 Cursor API 키가 모두 준비되었습니다.`
      : 'agent CLI와 Cursor API 키가 모두 준비되었습니다.';
  }
  if (!parts.cliFound && !parts.apiKeyReady) {
    return 'agent CLI 설치와 Cursor API 키 등록이 모두 필요합니다.';
  }
  if (!parts.apiKeyReady) {
    return 'Cursor API 키가 없습니다. 아래에서 등록하세요. (.env가 아니라 OS 자격 증명에 저장됩니다)';
  }
  return 'agent CLI가 없습니다. PowerShell에서 irm \'https://cursor.com/install?win32=true\' | iex 실행 후 터미널을 다시 여세요.';
}

export function grokConnectionBadge(parts: GrokConnectionParts): { label: string; connected: boolean } {
  if (parts.ready) return { label: '연결됨', connected: true };
  if (!parts.cliFound && !parts.apiKeyReady) return { label: '미연결', connected: false };
  if (!parts.apiKeyReady) return { label: 'API 키 필요', connected: false };
  return { label: 'CLI 필요', connected: false };
}
