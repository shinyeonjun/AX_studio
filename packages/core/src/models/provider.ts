import type { ZodType } from 'zod';

export interface StructuredGenerateInput<T> {
  schema: ZodType<T>;
  system: string;
  user: string;
  temperature?: number;
}

export interface TextGenerateInput {
  system: string;
  user: string;
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
