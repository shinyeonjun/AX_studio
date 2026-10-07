import { describe, expect, it } from 'vitest';
import { selectedInputText, withoutOptionIds } from './input';

describe('a chosen option in the person’s chat bubble', () => {
  it('keeps the id for the host but shows only the name', () => {
    const sent = selectedInputText({ id: 'channel', label: 'Slack 채널', type: 'text', required: true, options: [{ value: 'C123ABC', label: '#ax테스트' }] } as never, 'C123ABC');
    expect(sent).toBe('Slack 채널: #ax테스트 (ID: C123ABC)');
    expect(withoutOptionIds(sent)).toBe('Slack 채널: #ax테스트');
    expect(withoutOptionIds('API 연결: 쇼핑몰 (ID: shop)\n받는 사람: 팀장 (ID: u-1)')).toBe('API 연결: 쇼핑몰\n받는 사람: 팀장');
    expect(withoutOptionIds('(ID: 를 설명해 줘')).toBe('(ID: 를 설명해 줘');
  });
});
