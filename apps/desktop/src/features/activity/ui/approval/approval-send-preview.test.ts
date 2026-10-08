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

  it('names undeclared values generically instead of by their internal key', () => {
    expect(approvalPreview({ payload: { actionSnapshots: [{
      actionId: 'notify', actionRef: 'slack.message.send@1',
      params: { text: '안녕하세요', thread_ts_hint: '123', apiKey: 'k' },
    }] } })[0]?.fields).toEqual([
      { label: '메시지', value: '안녕하세요', long: false },
      { label: '기타 값', value: '123', long: false },
    ]);
  });

  it('shows nothing when the run has no frozen values', () => {
    expect(approvalPreview({ payload: null })).toEqual([]);
    expect(approvalPreview({ payload: { actionSnapshots: [{ actionId: 'x' }] } })).toEqual([]);
  });
});
