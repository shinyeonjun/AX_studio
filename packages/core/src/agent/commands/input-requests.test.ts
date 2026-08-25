import { describe, expect, it } from 'vitest';
import { inputRequestsForResult } from './input-requests.js';

describe('inputRequestsForResult', () => {
  it('maps missing workflow values to typed renderer requests', () => {
    const requests = inputRequestsForResult({
      command: 'workflow.create',
      status: 'invalid',
      issues: [{
        code: 'invalid_workflow_schema',
        path: 'steps.send.params',
        message: 'slack.message.send 단계에 필요한 값이 없습니다: channel, text',
      }],
    });

    expect(requests).toEqual([
      expect.objectContaining({ label: 'Slack 채널', type: 'slack_channel' }),
      expect.objectContaining({ label: '메시지 내용', type: 'text' }),
    ]);
  });

  it('labels the multi-HTTP connection chooser in Korean', () => {
    const requests = inputRequestsForResult({
      command: 'job.propose',
      status: 'needs_input',
      issues: [{
        code: 'missing_argument',
        path: 'args.fetch.connectionId',
        message: '필요한 값이 없습니다: connectionId',
      }],
    });

    expect(requests).toEqual([
      expect.objectContaining({ label: 'HTTP 연결', required: true }),
    ]);
  });

  it('does not turn connector or data-contract errors into fake text fields', () => {
    expect(inputRequestsForResult({
      command: 'workflow.create',
      status: 'needs_input',
      issues: [{
        code: 'missing_input_contract',
        path: 'steps.send',
        message: '이전 단계가 필요한 데이터를 제공하지 않습니다.',
        expected: ['TextArtifact'],
      }],
    })).toEqual([]);
  });
});
