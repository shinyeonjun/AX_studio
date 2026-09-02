import { describe, expect, it } from 'vitest';
import { inputRequestsForResult } from './input-requests.js';

describe('inputRequestsForResult', () => {
  it('returns producer-supplied typed renderer requests', () => {
    const requests = inputRequestsForResult({
      command: 'workflow.create',
      status: 'invalid',
      issues: [],
      inputRequests: [
        {
          id: 'send-channel',
          label: 'Slack 채널',
          type: 'slack_channel',
          required: true,
          placeholder: '#채널명 또는 채널 ID',
          reason: 'Slack 채널은 어디인가요?',
        },
        {
          id: 'send-text',
          label: '메시지 내용',
          type: 'text',
          required: true,
          reason: '무슨 내용을 보낼까요?',
        },
      ],
    });

    expect(requests).toEqual([
      expect.objectContaining({ label: 'Slack 채널', type: 'slack_channel' }),
      expect.objectContaining({ label: '메시지 내용', type: 'text' }),
    ]);
  });

  it('uses structured issue input metadata without parsing its localized message', () => {
    const requests = inputRequestsForResult({
      command: 'job.propose',
      status: 'needs_input',
      issues: [{
        code: 'missing_argument',
        message: '연결을 고르지 못했습니다.',
        inputRequests: [{
          id: 'http-connection',
          label: 'HTTP 연결',
          type: 'text',
          required: true,
          reason: '이 요청에 사용할 HTTP 연결은 무엇인가요?',
        }],
      }],
    });

    expect(requests).toEqual([
      expect.objectContaining({ label: 'HTTP 연결', required: true }),
    ]);
  });

  it('does not manufacture controls from localized issue text', () => {
    expect(inputRequestsForResult({
      command: 'workflow.create',
      status: 'invalid',
      issues: [{
        code: 'invalid_workflow_schema',
        path: 'steps.send.params',
        message: 'slack.message.send 단계에 필요한 값이 없습니다: channel, text',
      }],
    })).toEqual([]);
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
