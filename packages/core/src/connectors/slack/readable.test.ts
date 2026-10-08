import type { WebClient } from '@slack/web-api';
import { describe, expect, it, vi } from 'vitest';
import { readableSlackText, slackMemberIds, slackUserNames } from './readable.js';

describe('Slack messages as people read them', () => {
  it('turns Slack markup into plain words', () => {
    const names = new Map([['U1', '신연준']]);
    expect(readableSlackText('<@U1> <#C9|ax테스트> 확인 <https://x.test/a|보고서> <https://x.test/b> <!here> a &amp; b &lt;c&gt;', names))
      .toBe('@신연준 #ax테스트 확인 보고서 (https://x.test/a) https://x.test/b @here a & b <c>');
    expect(readableSlackText('<@U2> 안녕', names)).toBe('@U2 안녕');
  });

  it('collects who wrote and who is mentioned', () => {
    expect(slackMemberIds([{ user: 'U1', text: 'hi <@U2>' }, { user: 'U1', text: '' }])).toEqual(['U1', 'U2']);
  });

  it('asks once and stops when the token may not read member names', async () => {
    const info = vi.fn(async () => { throw Object.assign(new Error('missing_scope'), { data: { error: 'missing_scope' } }); });
    const names = await slackUserNames({ users: { info } } as unknown as WebClient, ['U1', 'U2', 'U3']);
    expect(names.size).toBe(0);
    expect(info).toHaveBeenCalledOnce();
  });

  it('uses the display name, then the real name', async () => {
    const info = vi.fn(async ({ user }: { user: string }) => ({ ok: true, user: user === 'U1'
      ? { name: 'yj', profile: { display_name: '연준', real_name: '신연준' } }
      : { name: 'kim', profile: { display_name: '', real_name: '김철수' } } }));
    const names = await slackUserNames({ users: { info } } as unknown as WebClient, ['U1', 'U2']);
    expect([...names]).toEqual([['U1', '연준'], ['U2', '김철수']]);
  });
});
