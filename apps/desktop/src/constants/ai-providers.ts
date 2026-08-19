import type { AiBrand, AiConnectionMode } from '../types/ai-provider';
import type { CliModelOption } from '../types/ai-provider';

import claudeIcon from '../images/ai/claude.png';
import openaiIcon from '../images/ai/gpt.webp';
import grokIcon from '../images/ai/grok.webp';

function exactModels(ids: readonly string[]): CliModelOption[] {
  return ids.map((id) => ({ id, label: id }));
}

/** packages/core model-options.ts 와 동기 — auto 등 제외 */
function normalizeModels(models: CliModelOption[]): CliModelOption[] {
  const excluded = new Set(['auto', 'codex-auto-review']);
  const seen = new Set<string>();
  return models.filter((model) => {
    const id = model.id.trim();
    if (!id || excluded.has(id.toLowerCase()) || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((model) => ({ id: model.id, label: model.id }));
}

const CLAUDE_CLI_MODELS = exactModels(['sonnet', 'opus', 'haiku', 'fable', 'sonnet[1m]', 'opus[1m]']);
const CLAUDE_API_MODELS = exactModels([
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-5-haiku-latest',
]);
const GPT_CLI_MODELS = exactModels([
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
]);
const GPT_API_MODELS = exactModels([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'o3',
  'o4-mini',
  'gpt-5.4',
]);
const GROK_MODELS = exactModels([
  'grok-4.6-high',
  'grok-4.6',
  'grok-4.5-high-fast',
  'grok-4.5',
  'grok',
]);

export interface AiProviderUiMeta {
  id: AiBrand;
  title: string;
  description: string;
  icon: string;
  envKey: string;
  cliProviderId: 'claude-cli' | 'codex-cli' | 'cursor-cli';
  cliModeLabel: string;
  cliLabel: string;
  apiModels: CliModelOption[];
  cliFallbackModels: CliModelOption[];
  apiDefaultModel: string;
  enabled: boolean;
}

export const AI_PROVIDER_UI_CATALOG: Record<AiBrand, AiProviderUiMeta> = {
  claude: {
    id: 'claude',
    title: 'Claude',
    description: 'Anthropic Claude · Claude CLI 또는 API',
    icon: claudeIcon,
    envKey: 'ANTHROPIC_API_KEY',
    cliProviderId: 'claude-cli',
    cliModeLabel: 'CLI',
    cliLabel: 'Claude CLI',
    apiModels: CLAUDE_API_MODELS,
    cliFallbackModels: CLAUDE_CLI_MODELS,
    apiDefaultModel: 'claude-sonnet-4-20250514',
    enabled: true,
  },
  gpt: {
    id: 'gpt',
    title: 'GPT',
    description: 'OpenAI GPT · Codex CLI 또는 API',
    icon: openaiIcon,
    envKey: 'OPENAI_API_KEY',
    cliProviderId: 'codex-cli',
    cliModeLabel: 'Codex',
    cliLabel: 'Codex CLI',
    apiModels: GPT_API_MODELS,
    cliFallbackModels: GPT_CLI_MODELS,
    apiDefaultModel: 'gpt-4o',
    enabled: true,
  },
  grok: {
    id: 'grok',
    title: 'Grok',
    description: 'xAI Grok · Cursor API + agent CLI',
    icon: grokIcon,
    envKey: 'CURSOR_API_KEY',
    cliProviderId: 'cursor-cli',
    cliModeLabel: 'CLI',
    cliLabel: 'agent CLI',
    apiModels: GROK_MODELS,
    cliFallbackModels: GROK_MODELS,
    apiDefaultModel: 'grok-4.6',
    enabled: true,
  },
  ollama: {
    id: 'ollama',
    title: 'Ollama',
    description: '로컬 Ollama (준비 중)',
    icon: openaiIcon,
    envKey: 'OLLAMA_API_KEY',
    cliProviderId: 'codex-cli',
    cliModeLabel: 'CLI',
    cliLabel: 'Ollama CLI',
    apiModels: exactModels(['llama3.3', 'qwen2.5']),
    cliFallbackModels: exactModels(['llama3.3', 'qwen2.5']),
    apiDefaultModel: 'llama3.3',
    enabled: false,
  },
};

export const ENABLED_AI_PROVIDER_IDS = (Object.keys(AI_PROVIDER_UI_CATALOG) as AiBrand[]).filter(
  (id) => AI_PROVIDER_UI_CATALOG[id].enabled,
);

export function brandFromProvider(provider?: string, brand?: AiBrand): AiBrand | null {
  if (brand) return brand;
  if (provider === 'claude-cli' || provider === 'anthropic-api') return 'claude';
  if (provider === 'codex-cli' || provider === 'openai-api') return 'gpt';
  if (provider === 'cursor-cli') return 'grok';
  return null;
}

export function modeLabel(mode: AiConnectionMode): string {
  return mode === 'api' ? 'API' : 'CLI';
}

export function modelsForBrand(
  brand: AiBrand,
  mode: AiConnectionMode,
  cliModels: CliModelOption[] | undefined,
): CliModelOption[] {
  const meta = AI_PROVIDER_UI_CATALOG[brand];
  if (mode === 'api') return meta.apiModels;
  const detected = cliModels && cliModels.length > 0 ? normalizeModels(cliModels) : [];
  return detected.length > 0 ? detected : meta.cliFallbackModels;
}
