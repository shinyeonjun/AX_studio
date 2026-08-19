import { describe, expect, it } from 'vitest';
import { resolveStepParams } from './ai-investigation.js';

describe('resolveStepParams', () => {
  it('interpolates trigger and step result templates and maps message to text', () => {
    const params = resolveStepParams(
      {
        channel: '#ax테스트',
        message: '📧 {{trigger.subject}}\n\n{{summarize.summary}}',
      },
      {
        executionId: 'exec-1',
        variables: { subject: '테스트' },
        log: () => {},
      },
      {
        summarize: { summary: '요약 본문' },
      },
    );

    expect(params.text).toBe('📧 테스트\n\n요약 본문');
    expect(params.channel).toBe('#ax테스트');
  });
});
