export type AiProviderId =
  | 'codex-cli'
  | 'claude-cli'
  | 'cursor-cli'
  | 'openai-api'
  | 'anthropic-api';

export type AiBrand = 'claude' | 'gpt' | 'grok' | 'ollama';
export type AiConnectionMode = 'cli' | 'api';

export interface CliModelOption {
  id: string;
  label: string;
}

export interface DetectedAiCli {
  id: 'codex-cli' | 'claude-cli' | 'cursor-cli';
  label: string;
  description: string;
  installed: boolean;
  binaryFound?: boolean;
  apiKeyConfigured?: boolean;
  command?: string;
  version?: string;
  models: CliModelOption[];
  defaultModel: string;
}

export interface AiSecretStatus {
  configured: boolean;
  masked?: string;
}

export interface AiBrandTomlPrefs {
  mode?: AiConnectionMode;
  model?: string;
}

export interface AiConfigSnapshot {
  path: string;
  active?: { brand: AiBrand; mode: AiConnectionMode; model: string };
  providers: Partial<Record<AiBrand, AiBrandTomlPrefs>>;
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
