/**
 * USD per 1M tokens. `cached` is input read from the provider's cache; `cacheWrite` is input written
 * to it (Anthropic bills 1-hour writes, which the Claude CLI uses, at twice the input price).
 */
export interface ModelPrice {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}

/**
 * Official standard-tier API prices, used only to show what the tokens would cost through the API
 * (CLI subscriptions are not billed per token). Sources: Anthropic model table (cached 2026-10-06);
 * OpenAI and Jev pricing pages (accessed 2026-10-13). A model missing here has no cost shown.
 */
const PRICES: Record<string, ModelPrice> = {
  'jev-1.13.0': { input: 0.042, cached: 0.042, cacheWrite: 0.042, output: 0 },
  'claude-fable-5-1': { input: 10, cached: 0.25, cacheWrite: 20, output: 50 },
  'claude-opus-5-5': { input: 4, cached: 0.2, cacheWrite: 8, output: 20 },
  'claude-sonnet-5-5': { input: 2, cached: 0.2, cacheWrite: 4, output: 10 },
  'claude-haiku-5-5': { input: 0.1, cached: 0.01, cacheWrite: 0.2, output: 0.5 },
  'gpt-6.1-sol': { input: 2, cached: 0.1, cacheWrite: 2, output: 10 },
  'gpt-6-luna': { input: 0.1, cached: 0.01, cacheWrite: 0.1, output: 0.5 },
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, cacheWrite: 0.2, output: 1.2 },
};

/** Short names the Claude CLI accepts, as the current model of that line. */
const ALIASES: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

export function priceForModel(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  const name = model.trim().toLowerCase();
  const resolved = ALIASES[name] ?? name;
  if (PRICES[resolved]) return PRICES[resolved];
  if (resolved.startsWith('jev-')) return PRICES['jev-1.13.0'];
  // Dated snapshots (`gpt-6-luna-2026-09-01`) bill as their model.
  const undated = resolved.replace(/-\d{4}-\d{2}-\d{2}$/u, '').replace(/-\d{8}$/u, '');
  return PRICES[undated];
}

/** Cost of one call in USD, or undefined when the model has no price or no tokens were reported. */
export function callCostUsd(call: { model?: string; inputTokens?: number; cachedInputTokens?: number; cacheWriteInputTokens?: number; outputTokens?: number }): number | undefined {
  const price = priceForModel(call.model);
  if (!price || (call.inputTokens === undefined && call.outputTokens === undefined)) return undefined;
  const input = call.inputTokens ?? 0;
  const cached = Math.min(call.cachedInputTokens ?? 0, input);
  const written = Math.min(call.cacheWriteInputTokens ?? 0, input - cached);
  return ((input - cached - written) * price.input + cached * price.cached + written * price.cacheWrite
    + (call.outputTokens ?? 0) * price.output) / 1e6;
}
