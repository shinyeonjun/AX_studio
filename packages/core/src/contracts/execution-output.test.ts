import { expect, it } from 'vitest';
import { parseExecutionOutput } from './execution-output.js';

it('accepts precise JSON values and refuses malformed or unbounded persisted results', () => {
  const output = { version: 1, fields: [{ path: 'total', valueJson: '0' }, { path: 'rows', valueJson: '[{"name":"<script>"}]' }] };
  expect(parseExecutionOutput(JSON.stringify(output))).toEqual(output);
  for (const value of [undefined, '', 'null', '{}', '{broken', ' '.repeat(262_145),
    JSON.stringify({ ...output, fields: [{ path: 'total', valueJson: 'undefined' }] }),
    JSON.stringify({ ...output, fields: Array.from({ length: 101 }, () => output.fields[0]) })]) {
    expect(parseExecutionOutput(value)).toBeUndefined();
  }
});
