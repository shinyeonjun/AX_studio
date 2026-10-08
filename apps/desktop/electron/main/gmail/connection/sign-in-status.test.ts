import { describe, expect, it, vi } from 'vitest';

vi.mock('../../state-broadcast.js', () => ({ notifyStateChanged: vi.fn() }));

import { GMAIL_SIGN_IN_EXPIRED, gmailSignInStatusRecorder } from './sign-in-status.js';

function store(config: Record<string, unknown>) {
  let row = { connector: 'gmail', connected: true, config };
  const setConnection = vi.fn((connector: string, connected: boolean, next?: Record<string, unknown>) => {
    row = { connector, connected, config: next ?? {} };
  });
  return { row: () => row, setConnection, getConnections: () => [row] };
}

describe('Gmail sign-in status on the connection', () => {
  it('says the Google login expired, and clears it once Gmail works again, writing only on change', () => {
    const s = store({ account: 'me@example.com', credentialRef: { connector: 'gmail', connectionId: 'c1' } });
    const record = gmailSignInStatusRecorder(s as never);
    record(true);
    expect(s.setConnection).not.toHaveBeenCalled();

    record(false);
    record(false);
    expect(s.setConnection).toHaveBeenCalledTimes(1);
    expect(s.row().config).toMatchObject({ account: 'me@example.com', lastError: GMAIL_SIGN_IN_EXPIRED });
    expect(s.row().connected).toBe(true);

    record(true);
    expect(s.row().config).not.toHaveProperty('lastError');
    expect(s.row().config).toMatchObject({ account: 'me@example.com' });
  });
});
