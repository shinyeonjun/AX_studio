import { describe, expect, it } from 'vitest';
import { AxInputRequestSchema } from './schema.js';

describe('structured input options', () => {
  it('accepts bounded selectable options with stable values', () => {
    expect(AxInputRequestSchema.parse({
      id: 'job-slack-channel',
      label: 'Slack 채널',
      type: 'slack_channel',
      options: [{ value: 'C123', label: '#운영', description: '5명 참여' }],
    })).toMatchObject({
      id: 'job-slack-channel',
      options: [{ value: 'C123', label: '#운영', description: '5명 참여' }],
    });
  });

  it('rejects unbounded or empty option values', () => {
    expect(() => AxInputRequestSchema.parse({
      id: 'target',
      label: '대상',
      type: 'text',
      options: [{ value: ' ', label: '비어 있는 값' }],
    })).toThrow();
  });
});
