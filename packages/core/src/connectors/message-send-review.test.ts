import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailConnector } from './gmail/connector.js';
import { SlackConnector } from './slack/connector.js';

const sdk = vi.hoisted(() => {
  const profile = vi.fn(); const send = vi.fn(); const auth = vi.fn(); const list = vi.fn(); const info = vi.fn(); const post = vi.fn();
  const googleClient = vi.fn(() => ({ users: { getProfile: profile, messages: { send } } }));
  const webClient = vi.fn(function () { return { auth: { test: auth }, conversations: { list, info }, chat: { postMessage: post } }; });
  return { profile, send, auth, list, info, post, googleClient, webClient };
});
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class { setCredentials() {} on() {} } }, gmail: sdk.googleClient } }));
vi.mock('@slack/web-api', () => ({ WebClient: sdk.webClient }));
beforeEach(() => {
  vi.clearAllMocks();
  sdk.profile.mockResolvedValue({ data: { emailAddress: 'verified@example.test' } });
  sdk.auth.mockResolvedValue({ ok: true, user_id: 'UQA123456', user: 'QA bot', team_id: 'TQA123456', team: 'QA workspace' });
  sdk.list.mockResolvedValue({ ok: true, channels: [{ id: 'CQA123456', name: 'qa-review' }] });
  sdk.info.mockResolvedValue({ ok: true, channel: { id: 'CQA123456', name: 'qa-review', is_archived: false } });
});
describe('real connector destination preparation with synthetic SDK mocks', () => {
  it('uses the authenticated Gmail profile instead of a configured account label, without sending', async () => {
    const connector = new GmailConnector({ clientId: 'synthetic-client', refreshToken: 'synthetic-token', email: 'stale@example.test' });
    expect(await connector.prepareMessageSend({ tool: 'gmail', to: ' recipient@example.test ', subject: '', body: 'Synthetic only' }))
      .toEqual({ provider: 'gmail', accountId: 'verified@example.test', accountLabel: 'verified@example.test', destinationId: 'recipient@example.test', destinationLabel: 'recipient@example.test' });
    expect(sdk.profile).toHaveBeenCalledWith({ userId: 'me' });
    expect(sdk.googleClient).toHaveBeenCalledWith(expect.objectContaining({ retry: false, timeout: 30000 }));
    expect(sdk.send).not.toHaveBeenCalled();
  });
  it('fails Gmail preparation when profile identity is absent or unavailable', async () => {
    const connector = new GmailConnector({ clientId: 'synthetic', refreshToken: 'synthetic' });
    sdk.profile.mockResolvedValueOnce({ data: {} });
    await expect(connector.prepareMessageSend({ tool: 'gmail', to: 'recipient@example.test', subject: '', body: 'Fixture' })).rejects.toThrow('identity_unverified');
    sdk.profile.mockRejectedValueOnce(new Error('Synthetic missing scope'));
    await expect(connector.prepareMessageSend({ tool: 'gmail', to: 'recipient@example.test', subject: '', body: 'Fixture' })).rejects.toThrow('missing scope');
    expect(sdk.send).not.toHaveBeenCalled();
  });
  it('rejects malformed Gmail destinations before constructing a client', async () => {
    await expect(new GmailConnector({ clientId: 'synthetic', refreshToken: 'synthetic' })
      .prepareMessageSend({ tool: 'gmail', to: 'unknown person', subject: '', body: 'Fixture' })).rejects.toThrow('recipient_invalid');
    expect(sdk.googleClient).not.toHaveBeenCalled();
  });
  it.each(['#qa-review', 'CQA123456'])('resolves Slack %s through authenticated workspace info without posting', async channel => {
    expect(await new SlackConnector('synthetic-token').prepareMessageSend({ tool: 'slack', channel, text: 'Fixture' }))
      .toEqual({ provider: 'slack', accountId: 'UQA123456', accountLabel: 'QA bot', workspaceId: 'TQA123456', workspaceLabel: 'QA workspace', destinationId: 'CQA123456', destinationLabel: '#qa-review' });
    expect(sdk.info).toHaveBeenCalledWith({ channel: 'CQA123456' });
    expect(sdk.list).toHaveBeenCalledTimes(channel.startsWith('#') ? 1 : 0);
    expect(sdk.webClient).toHaveBeenCalledWith('synthetic-token', expect.objectContaining({ retryConfig: { retries: 0 }, rejectRateLimitedCalls: true }));
    expect(sdk.post).not.toHaveBeenCalled();
  });
  it.each([
    { ok: false }, { ok: true, user_id: 'UQA123456' }, { ok: true, team_id: 'TQA123456' },
  ])('blocks Slack when authentication identity is incomplete', async auth => {
    sdk.auth.mockResolvedValueOnce(auth);
    await expect(new SlackConnector('synthetic').prepareMessageSend({ tool: 'slack', channel: '#qa-review', text: 'Fixture' })).rejects.toThrow('identity_unverified');
    expect(sdk.list).not.toHaveBeenCalled(); expect(sdk.info).not.toHaveBeenCalled(); expect(sdk.post).not.toHaveBeenCalled();
  });
  it.each([
    { ok: false, error: 'missing_scope' }, { ok: true, channel: { id: 'COTHER' } },
    { ok: true, channel: { id: 'CQA123456', is_archived: true } }, { ok: true },
  ])('blocks unavailable, mismatched or archived Slack channels', async info => {
    sdk.info.mockResolvedValueOnce(info);
    await expect(new SlackConnector('synthetic').prepareMessageSend({ tool: 'slack', channel: 'CQA123456', text: 'Fixture' })).rejects.toThrow('destination_unknown');
    expect(sdk.post).not.toHaveBeenCalled();
  });
  it('does not invent a Slack channel when listing finds none', async () => {
    sdk.list.mockResolvedValueOnce({ ok: true, channels: [] });
    await expect(new SlackConnector('synthetic').prepareMessageSend({ tool: 'slack', channel: '#missing', text: 'Fixture' })).rejects.toThrow('destination_unknown');
    expect(sdk.info).not.toHaveBeenCalled(); expect(sdk.post).not.toHaveBeenCalled();
  });
});
