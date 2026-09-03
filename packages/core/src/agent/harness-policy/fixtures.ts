import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../model/provider.js';

export class CloudSpyProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  structuredCalls = 0;
  lastUntrusted?: string;
  lastSystem = '';
  lastImages?: StructuredGenerateInput<unknown>['images'];

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.structuredCalls += 1;
    this.lastSystem = input.system;
    this.lastUntrusted = input.system.includes('[UNTRUSTED DATA]') ? 'present' : 'absent';
    this.lastImages = input.images;
    return input.schema.parse({ ok: true });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}
