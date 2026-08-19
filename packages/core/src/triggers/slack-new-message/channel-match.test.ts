import { describe, expect, it } from 'vitest';
import { slackChannelMatches } from './channel-match.js';

describe('slackChannelMatches', () => {
  it('matches channel id and names', () => {
    const event = { channel: '#general', channelId: 'C123' };
    expect(slackChannelMatches('#general', event)).toBe(true);
    expect(slackChannelMatches('general', event)).toBe(true);
    expect(slackChannelMatches('C123', event)).toBe(true);
    expect(slackChannelMatches('#random', event)).toBe(false);
  });
});
