import { describe, expect, it } from 'vitest';
import { approvalPreview } from './approval-send-preview';

describe('what an approval will send', () => {
  it('lists the frozen values with their field names, never secrets', () => {
    expect(approvalPreview({ payload: { actionSnapshots: [{
      actionId: 'notify', actionRef: 'slack.message.send@1',
      params: { channel: '#ax테스트', text: '이번 주 회의가 목요일로 바뀌었어요.', botToken: 'xoxb-secret' },
    }] } })).toEqual([{ title: 'Slack 메시지', fields: [
      { label: 'Slack 채널', value: '#ax테스트', long: false },
      { label: '메시지', value: '이번 주 회의가 목요일로 바뀌었어요.', long: false },
    ] }]);
  });

  it('shows nothing when the run has no frozen values', () => {
    expect(approvalPreview({ payload: null })).toEqual([]);
    expect(approvalPreview({ payload: { actionSnapshots: [{ actionId: 'x' }] } })).toEqual([]);
  });
});
