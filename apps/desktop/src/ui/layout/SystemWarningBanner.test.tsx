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
    expect(markup).toContain('OS 키링');
    expect(markup).toContain('경고 닫기');
  });
});
