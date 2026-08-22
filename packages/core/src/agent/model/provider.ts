import type { ZodType } from 'zod';
import type { ChatMessage } from './chat.js';
import type { AgentProgressEvent } from '../progress.js';

export interface ModelImageInput {
  data: Uint8Array;
  mimeType: string;
  pageIndex?: number;
  filename?: string;
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
  timeoutMs?: number;
  sessionId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (event: AgentProgressEvent) => void;
  /** CLI providers: maps to --max-turns when supported. */
  maxTurns?: number;
}

export interface ModelProvider {
  readonly name: string;
  readonly model?: string;
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
