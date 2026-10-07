import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../../../../types/app-state';
import { JevSetupNotice, needsJevSetup } from './JevSetupNotice';

const base: AppState = { globalActive: true, works: [], connections: [], pendingApprovals: 0, approvals: [], executions: [] };
const noop = () => {};

describe('JevSetupNotice', () => {
  it('stays hidden until state loads and when Jev is ready', () => {
    expect(needsJevSetup(null)).toBe(false);
    expect(renderToStaticMarkup(<JevSetupNotice state={{ ...base, jevDecisionConfigured: true, jevDecisionEnabled: true }} onOpenJevSettings={noop} />)).toBe('');
  });

  it('asks to connect Jev when it is not configured', () => {
    const html = renderToStaticMarkup(<JevSetupNotice state={base} onOpenJevSettings={noop} />);
    expect(html).toContain('연결되지 않아');
    expect(html).toContain('판단 엔진 연결하기');
  });

  it('asks to turn Jev on when configured but disabled', () => {
    const html = renderToStaticMarkup(<JevSetupNotice state={{ ...base, jevDecisionConfigured: true, jevDecisionEnabled: false }} onOpenJevSettings={noop} />);
    expect(html).toContain('판단 엔진 켜기');
  });
});
