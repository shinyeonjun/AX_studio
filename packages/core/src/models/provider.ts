import type { ZodType } from 'zod';
import type { ChatMessage } from './chat.js';

export interface StructuredGenerateInput<T> {
  schema: ZodType<T>;
  system: string;
  /** Single-turn prompt. Ignored when `messages` is set. */
  user?: string;
  /** Multi-turn session. API providers send this natively; CLI flattens it. */
  messages?: ChatMessage[];
  temperature?: number;
}

export interface TextGenerateInput {
  system: string;
  user?: string;
  messages?: ChatMessage[];
  temperature?: number;
}

export interface ModelProvider {
  readonly name: string;
  generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T>;
  generateText(input: TextGenerateInput): Promise<string>;
}

export interface ModelProviderConfig {
  baseURL: string;
  apiKey?: string;
  model: string;
}
