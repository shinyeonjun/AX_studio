export type { AiBrand, AiConnectionMode, AiProviderId, CliModelOption } from '@ax-studio/core/ai-catalog';

export interface DetectedAiCli {
  id: 'codex-cli' | 'claude-cli' | 'cursor-cli';
  label: string;
  description: string;
  installed: boolean;
  binaryFound?: boolean;
  apiKeyConfigured?: boolean;
  command?: string;
  version?: string;
  models: import('@ax-studio/core/ai-catalog').CliModelOption[];
  defaultModel: string;
}

export interface AiSecretStatus {
  configured: boolean;
  masked?: string;
}

export interface AiBrandTomlPrefs {
  mode?: import('@ax-studio/core/ai-catalog').AiConnectionMode;
  model?: string;
}

export interface AiConfigSnapshot {
  path: string;
  active?: { brand: import('@ax-studio/core/ai-catalog').AiBrand; mode: import('@ax-studio/core/ai-catalog').AiConnectionMode; model: string };
  providers: Partial<Record<import('@ax-studio/core/ai-catalog').AiBrand, AiBrandTomlPrefs>>;
  secrets: Record<string, AiSecretStatus>;
}

export interface EnvSecretStatus {
  configured: boolean;
  masked?: string;
  envFilePath?: string;
}

export interface CursorApiKeyTestResult {
  ok: boolean;
  email?: string;
  apiKeyName?: string;
  masked?: string;
}

export interface AiCliTestResult {
  ok: boolean;
  command: string;
  version?: string;
}

export interface AiApiTestResult {
  ok: boolean;
  label: string;
  masked?: string;
}
