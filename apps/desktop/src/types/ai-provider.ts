export type { AiBrand, CliModelOption } from '@ax-studio/core';

export interface DetectedAiCli {
  id: import('@ax-studio/core').CliProviderId;
  label: string;
  description: string;
  installed: boolean;
  command?: string;
  version?: string;
  models: import('@ax-studio/core').CliModelOption[];
  defaultModel: string;
}

interface AiBrandTomlPrefs {
  model?: string;
}

export interface AiConfigSnapshot {
  path: string;
  active?: { brand: import('@ax-studio/core').AiBrand; model: string };
  providers: Partial<Record<import('@ax-studio/core').AiBrand, AiBrandTomlPrefs>>;
}

export interface AiCliTestResult {
  ok: boolean;
  command: string;
  version?: string;
}
