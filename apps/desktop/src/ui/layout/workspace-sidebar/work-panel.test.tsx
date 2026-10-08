import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkHealthNote } from './work-panel';

const at = new Date(Date.now() - 5 * 60_000).toISOString();

describe('WorkHealthNote', () => {
  it('renders nothing for a healthy workflow', () => {
    expect(renderToStaticMarkup(<WorkHealthNote work={{}} />)).toBe('');
    expect(renderToStaticMarkup(<WorkHealthNote work={{ triggerDeadLetters: [], lastOutcome: { occurrenceKey: 'k', status: 'success', at } }} />)).toBe('');
  });

  it('shows a skipped schedule occurrence and exhausted trigger events', () => {
    const markup = renderToStaticMarkup(
      <WorkHealthNote
        work={{
          lastOutcome: { occurrenceKey: 'k', status: 'skipped', reason: 'pending_approval', at },
          triggerDeadLetters: [
            { dedupeKey: 'a', attempts: 5, reason: 'execution_failed', at },
            { dedupeKey: 'b', attempts: 5, reason: 'execution_failed', at },
          ],
        }}
      />,
    );
    expect(markup).toContain('최근 일정 건너뜀');
    expect(markup).toContain('놓친 자동 시작 2건');
    expect(markup).not.toContain('execution_failed');
    expect(markup).toContain('승인을 기다리는 중입니다');
  });
});

describe('a job whose new-item check keeps failing', () => {
  const at = '2026-10-08T00:00:00.000Z';
  it('says so at once when the person must act, such as an expired Google login', () => {
    const html = renderToStaticMarkup(<WorkHealthNote work={{ triggerDeadLetters: [], triggerPollFailure: {
      code: 'oauth_refresh_failed', message: 'Google 로그인이 만료됐어요. 설정에서 Gmail을 다시 연결해 주세요.', firstFailedAt: at, lastFailedAt: at,
    } }} />);
    expect(html).toContain('자동 시작 확인 안 됨');
    expect(html).toContain('Gmail을 다시 연결해 주세요');
  });

  it('waits out a brief failure, and speaks up once it has lasted five minutes', () => {
    const brief = { code: 'request_timeout', message: '서버가 제때 응답하지 않았어요.', firstFailedAt: at, lastFailedAt: '2026-10-08T00:01:00.000Z' };
    expect(renderToStaticMarkup(<WorkHealthNote work={{ triggerDeadLetters: [], triggerPollFailure: brief }} />)).toBe('');
    const lasting = { ...brief, lastFailedAt: '2026-10-08T00:06:00.000Z' };
    expect(renderToStaticMarkup(<WorkHealthNote work={{ triggerDeadLetters: [], triggerPollFailure: lasting }} />)).toContain('자동 시작 확인 안 됨');
  });
});
