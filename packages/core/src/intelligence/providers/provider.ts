import type { ZodType } from 'zod';
import type { ChatMessage } from './chat.js';
import type { AgentProgressEvent, ModelImageInput } from '../../contracts/investigation-runner.js';

export type { AgentProgressEvent, ModelImageInput } from '../../contracts/investigation-runner.js';

/** Provider-reported counts; an absent field is unknown, not zero. */
export interface ModelTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
}

/** All input tokens, cache reads and writes included, whatever the provider's convention. */
export function inputTokensWithCache(model: Pick<ModelProvider, 'usageInputExcludesCache'>, usage: ModelTokenUsage): number | undefined {
  if (usage.inputTokens === undefined) return undefined;
  return usage.inputTokens + (model.usageInputExcludesCache ? (usage.cachedInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0) : 0);
}

export function reportModelTokenUsage(
  input: { onUsage?: (usage: ModelTokenUsage) => void },
  usage: ModelTokenUsage,
): void {
  const normalized = Object.fromEntries(
    Object.entries(usage).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isSafeInteger(entry[1]) && entry[1] >= 0
    )),
  ) as ModelTokenUsage;
  if (Object.keys(normalized).length === 0) return;
  try { input.onUsage?.(normalized); } catch { /* Telemetry must not fail model work. */ }
}


export interface StructuredGenerateInput<T> {
  schema: ZodType<T>;
  system: string;
  /** Single-turn prompt. Ignored when `messages` is set. */
  user?: string;
  /** Multi-turn session. API providers send this natively; CLI flattens it. */
  messages?: ChatMessage[];
  /** Images attached to the current user turn when the provider supports vision. */
  images?: ModelImageInput[];
  temperature?: number;
  timeoutMs?: number;
  sessionId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (event: AgentProgressEvent) => void;
  onUsage?: (usage: ModelTokenUsage) => void;
  logContext?: string;
  codexReasoningEffort?: 'low' | 'medium' | 'high';
  /** CLI providers: maps to --max-turns when supported. */
  maxTurns?: number;
}

export interface TextGenerateInput {
  system: string;
  user?: string;
  messages?: ChatMessage[];
  images?: ModelImageInput[];
  temperature?: number;
  /** Bound concise host-facing replies; CLI providers may ignore this field. */
  maxOutputTokens?: number;
  codexReasoningEffort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  sessionId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (event: AgentProgressEvent) => void;
  onUsage?: (usage: ModelTokenUsage) => void;
  /** CLI providers: maps to --max-turns when supported. */
  maxTurns?: number;
}

export interface ModelProvider {
  dispose?(): Promise<void>;
  readonly name: string;
  readonly model?: string;
  /**
   * Anthropic reports `inputTokens` without the cache reads and writes; OpenAI-style providers
   * count cache reads inside it. True for the former, so usage totals add the cache back.
   */
  readonly usageInputExcludesCache?: boolean;
  /** True only when the provider adapter passes image bytes to the model API. */
  readonly supportsVision?: boolean;
  generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T>;
  generateText(input: TextGenerateInput): Promise<string>;
}

export interface ModelProviderConfig {
  baseURL: string;
  apiKey?: string;
  model: string;
}
