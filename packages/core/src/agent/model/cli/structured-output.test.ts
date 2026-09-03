import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseStructuredOutput } from '../cli-json.js';

describe('cli structured output parsing', () => {
  it('parses fenced json and claude wrapper', () => {
    const schema = z.object({ category: z.string() });
    expect(parseStructuredOutput('```json\n{"category":"critical"}\n```', schema)).toEqual({ category: 'critical' });
    expect(
      parseStructuredOutput(JSON.stringify({ structured_output: { category: 'ok' } }), schema),
    ).toEqual({ category: 'ok' });
  });

  it('skips empty structured_output and reads result json', () => {
    const schema = z.object({ name: z.string() });
    expect(
      parseStructuredOutput(
        JSON.stringify({
          type: 'result',
          structured_output: {},
          result: JSON.stringify({ name: 'PDF 요약' }),
        }),
        schema,
      ),
    ).toEqual({ name: 'PDF 요약' });
  });
});
