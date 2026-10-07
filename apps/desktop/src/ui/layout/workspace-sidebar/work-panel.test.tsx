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
