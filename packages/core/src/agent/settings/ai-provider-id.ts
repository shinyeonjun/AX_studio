export const CLI_PROVIDER_IDS = ['codex-cli', 'claude-cli', 'cursor-cli'] as const;
export type CliProviderId = (typeof CLI_PROVIDER_IDS)[number];

export const API_PROVIDER_IDS = ['openai-api', 'anthropic-api', 'grok-api'] as const;
export type ApiProviderId = (typeof API_PROVIDER_IDS)[number];

export const AI_PROVIDER_IDS = [...CLI_PROVIDER_IDS, ...API_PROVIDER_IDS] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_BRANDS = ['claude', 'gpt', 'grok', 'ollama'] as const;
export type AiBrand = (typeof AI_BRANDS)[number];

export const AI_CONNECTION_MODES = ['cli', 'api'] as const;
export type AiConnectionMode = (typeof AI_CONNECTION_MODES)[number];

export function isCliProviderId(id: AiProviderId): id is CliProviderId {
  return (CLI_PROVIDER_IDS as readonly string[]).includes(id);
}
