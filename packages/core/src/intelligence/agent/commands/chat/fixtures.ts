import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../model/provider.js';

export function scriptedModel(
  outputs: unknown[],
  seen: StructuredGenerateInput<unknown>[],
  name = 'test-provider',
  textOutputs: string[] = [],
  textSeen: TextGenerateInput[] = [],
): ModelProvider {
  return {
    name,
    async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
      seen.push(input as StructuredGenerateInput<unknown>);
      const next = outputs.shift();
      if (next === undefined) throw new Error('test_model_script_exhausted');
      return next as T;
    },
    async generateText(input: TextGenerateInput): Promise<string> {
      textSeen.push(input);
      const next = textOutputs.shift();
      if (next === undefined) throw new Error('text_generation_not_scripted');
      return next;
    },
  };
}
