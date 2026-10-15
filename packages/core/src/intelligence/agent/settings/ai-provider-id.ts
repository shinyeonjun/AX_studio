export const CLI_PROVIDER_IDS = ['codex-cli', 'claude-cli'] as const;
export type CliProviderId = (typeof CLI_PROVIDER_IDS)[number];

/** AI runs only through the installed CLIs; the API providers were removed. */
export type AiProviderId = CliProviderId;

export const AI_BRANDS = ['claude', 'gpt'] as const;
export type AiBrand = (typeof AI_BRANDS)[number];

export interface AiProviderConfig {
  provider: AiProviderId;
  model?: string;
  brand?: AiBrand;
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (CLI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isAiBrand(value: unknown): value is AiBrand {
  return typeof value === 'string' && (AI_BRANDS as readonly string[]).includes(value);
}
