import { describe, expect, it } from 'vitest';
import type { AppState } from '../../../types/app-state';
import { connectorAttention, isConnectorConnected } from './model';

function state(patch: Partial<AppState>): AppState {
  return { globalActive: true, works: [], connections: [], pendingApprovals: 0, approvals: [], executions: [], ...patch };
}

describe('connectors that are connected but not usable now', () => {
  it('passes on why a connected Gmail cannot be used', () => {
    const reason = 'Google 로그인이 만료됐어요. 이 Gmail을 다시 연결해 주세요.';
    const expired = state({ connections: [{ connector: 'gmail', connected: true, lastError: reason }] });
    expect(isConnectorConnected(expired, 'gmail')).toBe(true);
    expect(connectorAttention(expired, 'gmail')).toBe(reason);
    expect(connectorAttention(state({ connections: [{ connector: 'gmail', connected: true }] }), 'gmail')).toBeUndefined();
    // Not connected is its own state, not "needs attention".
    expect(connectorAttention(state({ connections: [{ connector: 'gmail', connected: false, lastError: reason }] }), 'gmail')).toBeUndefined();
  });

  it('counts connected folders that can no longer be opened', () => {
    const folders = [
      { id: 'a', label: '매출', path: 'D:/sales', addedAt: '' },
      { id: 'b', label: '테스트', path: 'D:/ax', addedAt: '', missing: true },
    ];
    expect(connectorAttention(state({ localFolders: folders }), 'local-folder')).toBe('연결한 폴더 1개를 찾을 수 없어요.');
    expect(connectorAttention(state({ localFolders: [folders[0]!] }), 'local-folder')).toBeUndefined();
  });

  it('flags an API or a database whose saved login is gone', () => {
    expect(connectorAttention(state({ connections: [{ connector: 'http', connected: true,
      endpoints: [{ id: 'shop', baseUrl: 'https://shop.example.invalid/', needsReconnect: true }] }] }), 'http'))
      .toBe('다시 연결해야 하는 API가 있어요.');
    expect(connectorAttention(state({ connections: [{ connector: 'rdb', connected: true,
      databases: [{ id: 'main', needsReconnect: true }] }] }), 'rdb'))
      .toBe('다시 연결해야 하는 데이터베이스가 있어요.');
  });
});
