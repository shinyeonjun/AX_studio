export type { AiBrand, AiConnectionMode, CliModelOption } from '@ax-studio/core';

export interface DetectedAiCli {
  id: 'codex-cli' | 'claude-cli' | 'cursor-cli';
  label: string;
  description: string;
  installed: boolean;
  binaryFound?: boolean;
  apiKeyConfigured?: boolean;
  command?: string;
  version?: string;
  models: import('@ax-studio/core').CliModelOption[];
  defaultModel: string;
}

export interface AiSecretStatus {
  configured: boolean;
  masked?: string;
}

export interface AiBrandTomlPrefs {
  mode?: import('@ax-studio/core').AiConnectionMode;
  model?: string;
}

export interface AiConfigSnapshot {
  path: string;
  active?: { brand: import('@ax-studio/core').AiBrand; mode: import('@ax-studio/core').AiConnectionMode; model: string };
  providers: Partial<Record<import('@ax-studio/core').AiBrand, AiBrandTomlPrefs>>;
  secrets: Record<string, AiSecretStatus>;
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
