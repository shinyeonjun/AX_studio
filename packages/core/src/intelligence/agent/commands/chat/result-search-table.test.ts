import { describe, expect, it } from 'vitest';
import type { AxCommand, AxCommandResult } from '../schema.js';
import { tableForJevTransform } from './result.js';

describe('a search answer as a table', () => {
  it('is the messages, not the citations a search also returns', () => {
    const command = { name: 'capability.invoke', args: { id: 'gmail.messages.search', params: { includeMetadata: true } } } as AxCommand;
    const result = {
      command: 'capability.invoke',
      status: 'ok',
      data: {
        capabilityId: 'gmail.messages.search',
        data: {
          messages: [{ id: 'm1', subject: '견적 요청', from: 'a@example.com' }, { id: 'm2', subject: '회의', from: 'b@example.com' }],
          hits: [{ ref: { connector: 'gmail', kind: 'email', id: 'm1' }, score: 1 }, { ref: { connector: 'gmail', kind: 'email', id: 'm2' }, score: 1 }],
          limit: 3,
          truncated: false,
        },
        citations: [],
        untrusted: true,
      },
    } as unknown as AxCommandResult;
    const table = tableForJevTransform(command, result);
    expect(table?.columns.map((column) => column.name)).toEqual(['id', 'subject', 'from']);
    expect(table?.rows).toHaveLength(2);
  });
});
