import { describe, expect, it } from 'vitest';
import { coercePortBinding } from '../bindings.js';
import { parseBindingsRecord } from '../../workflow/canvas/draft/schema.js';

describe('coercePortBinding', () => {
  it('parses step.output shorthand strings', () => {
    expect(coercePortBinding('summarize.summary')).toEqual({
      from: 'summarize',
      output: 'summary',
    });
    expect(coercePortBinding('trigger.filePath')).toEqual({
      from: 'trigger',
      output: 'filePath',
    });
  });

  it('parses ref objects and JSON-encoded bindings', () => {
    expect(coercePortBinding({ ref: 'summarize-mails.summary' })).toEqual({
      from: 'summarize-mails',
      output: 'summary',
    });
    expect(parseBindingsRecord({ text: 'summarize.summary', body: '{"from":"draft","output":"body"}' })).toEqual({
      text: { from: 'summarize', output: 'summary' },
      body: { from: 'draft', output: 'body' },
    });
  });
});
