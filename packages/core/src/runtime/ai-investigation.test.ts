import { describe, expect, it } from 'vitest';
import { resolveStepParams } from './ai-investigation.js';

describe('resolveStepParams', () => {
  it('interpolates only explicitly declared parameter values', () => {
    const params = resolveStepParams(
      {
        channel: '#ax테스트',
        text: '📧 {{trigger.subject}}\n\n{{summarize.summary}}',
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
    expect(params).not.toHaveProperty('message');
  });

  it('resolves nested ref objects and first matching item in list results', () => {
    const params = resolveStepParams(
      {
        messageId: { ref: 'search-mails.messageId' },
        text: { ref: 'summarize-mails.summary' },
      },
      { executionId: 'exec-1', variables: {}, log: () => {} },
      {
        'search-mails': [{ id: 'message-1', threadId: 'thread-1' }],
        'summarize-mails': { summary: '요약 결과' },
      },
    );

    expect(params).toEqual({ messageId: 'message-1', text: '요약 결과' });
  });

  it('fails closed when a template reference is missing', () => {
    expect(() =>
      resolveStepParams(
        { text: '{{classify.summary}}' },
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { classify: { riskLevel: 'high' } },
      ),
    ).toThrow(/classify\.summary/);
  });

  it('fails closed when an object binding reference is missing', () => {
    expect(() =>
      resolveStepParams(
        { payload: { ref: 'classify.riskLevel' } },
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { classify: {} },
      ),
    ).toThrow(/classify\.riskLevel/);
  });

  it('fails closed when a template reference names an inherited property', () => {
    expect(() =>
      resolveStepParams(
        { text: '{{toString}}' },
        { executionId: 'exec-1', variables: {}, log: () => {} },
        {},
      ),
    ).toThrow(/toString/);

    expect(() =>
      resolveStepParams(
        { text: '{{classify.constructor}}' },
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { classify: { riskLevel: 'high' } },
      ),
    ).toThrow(/classify\.constructor/);
  });
});
