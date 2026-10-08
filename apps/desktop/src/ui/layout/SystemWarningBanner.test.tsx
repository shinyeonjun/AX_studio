import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppState } from '../../types/app-state';
import { activeSystemWarnings, SystemWarningBanner } from './SystemWarningBanner';

const baseState: AppState = {
  globalActive: true,
  works: [],
  connections: [],
  pendingApprovals: 0,
  approvals: [],
  executions: [],
};

describe('SystemWarningBanner', () => {
  it('renders nothing when storage is healthy', () => {
    expect(activeSystemWarnings(baseState)).toEqual([]);
    expect(renderToStaticMarkup(<SystemWarningBanner state={baseState} />)).toBe('');
    expect(renderToStaticMarkup(<SystemWarningBanner state={null} />)).toBe('');
  });

  it('explains database fallback and plaintext credential storage with a dismiss control', () => {
    const state: AppState = { ...baseState, databaseBackendFallback: true, credentialStorageWarning: 'basic_text_backend' };
    expect(activeSystemWarnings(state)).toEqual(['databaseBackendFallback', 'credentialStorageWarning']);
    const markup = renderToStaticMarkup(<SystemWarningBanner state={state} />);
    expect(markup).toContain('임시 저장 방식');
    expect(markup).toContain('비밀번호 보관함을 쓸 수 없어');
    expect(markup).not.toContain('gnome-keyring');
    expect(markup).toContain('경고 닫기');
  });

  it('counts skipped corrupt rows per area and folds identifiers away for support', () => {
    const state: AppState = {
      ...baseState,
      corruptRows: {
        total: 3,
        byTable: { approvals: 3 },
        rows: [{ table: 'approvals', id: 'ap-1', code: 'invalid_approval_json', detectedAt: '2026-10-06T00:00:00.000Z' }],
      },
    };
    const markup = renderToStaticMarkup(<SystemWarningBanner state={state} />);
    expect(markup).toContain('손상된 데이터 3건(승인 요청 3건)');
    expect(markup).toContain('지원팀에 보낼 상세 정보');
    expect(markup).not.toContain('<details open');
    expect(markup.split('<details')[0]).not.toContain('approvals');
    expect(markup).toContain('ap-1');
    expect(markup).toContain('invalid_approval_json');
    expect(markup).toContain('외 2건');
  });

  it('stays hidden when no rows were skipped', () => {
    const state: AppState = { ...baseState, corruptRows: { total: 0, byTable: {}, rows: [] } };
    expect(renderToStaticMarkup(<SystemWarningBanner state={state} />)).toBe('');
  });
});
