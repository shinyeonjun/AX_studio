import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../../../../types/app-state';
import { GmailConnectionForm } from './GmailConnectionForm';

function stateWithScopes(scopes: string[]): AppState {
  return {
    globalActive: true,
    works: [],
    connections: [{ connector: 'gmail', connected: true }],
    pendingApprovals: 0,
    approvals: [],
    executions: [],
    gmailScopes: scopes,
  };
}

function ticks(markup: string): number {
  return (markup.match(/✓ /gu) ?? []).length;
}

describe('GmailConnectionForm capabilities', () => {
  const noop = async () => undefined;

  it('treats compose as permitting send when gmail.send is not granted', () => {
    const markup = renderToStaticMarkup(
      <GmailConnectionForm
        state={stateWithScopes([
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.compose',
        ])}
        onConnect={noop}
        onDisconnect={noop}
      />,
    );
    expect(ticks(markup)).toBe(3);
    expect(markup).toContain('승인된 메일 발송');
  });

  it('does not claim compose or send for a read-only grant', () => {
    const markup = renderToStaticMarkup(
      <GmailConnectionForm
        state={stateWithScopes(['https://www.googleapis.com/auth/gmail.readonly'])}
        onConnect={noop}
        onDisconnect={noop}
      />,
    );
    expect(ticks(markup)).toBe(1);
  });

  it('tells end users to ask an administrator when Gmail sign-in is not set up', () => {
    const state = { ...stateWithScopes([]), connections: [], gmailOAuthConfigured: false };
    const markup = renderToStaticMarkup(<GmailConnectionForm state={state} onConnect={noop} onDisconnect={noop} />);
    expect(markup).toContain('Gmail 연결 기능이 이 설치본에 준비되지 않았어요. 관리자에게 문의해 주세요.');
  });
});
