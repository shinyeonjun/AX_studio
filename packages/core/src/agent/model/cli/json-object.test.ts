import { describe, expect, it } from 'vitest';
import { parseJsonObject } from '../cli-json.js';

describe('cli JSON object parsing', () => {
  it('surfaces CLI error text instead of raw JSON.parse messages', () => {
    expect(() => parseJsonObject('error: unexpected argument --json-schema')).toThrow(
      'error: unexpected argument --json-schema',
    );
  });

  it('parses the first complete JSON object from explanatory output', () => {
    expect(
      parseJsonObject('Result: {"text":"keep {braces} and \\"quotes\\""}\nExample: {"text":"ignore"}'),
    ).toEqual({ text: 'keep {braces} and "quotes"' });
  });

  it('repairs literal control characters inside nested JSON strings', () => {
    expect(
      parseJsonObject(`{
        "text": "
[CRITICAL] 고객-티켓 불일치: Naver

DB 고객 priority: normal
"
      }`),
    ).toEqual({
      text: '\n[CRITICAL] 고객-티켓 불일치: Naver\n\nDB 고객 priority: normal\n',
    });
  });
});
