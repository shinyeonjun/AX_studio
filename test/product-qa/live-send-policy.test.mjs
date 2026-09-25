import assert from 'node:assert/strict';
import test from 'node:test';
import { emailAddresses, isAllowedTestChannel, isAllowedTestRecipients } from './live-send-policy.mjs';

test('live Gmail sends require a non-empty exact recipient allowlist', () => {
  assert.equal(isAllowedTestRecipients('qa@example.com', new Set()), false);
  assert.equal(isAllowedTestRecipients('qa@example.com', new Set(['qa@example.com'])), true);
  assert.equal(isAllowedTestRecipients('qa@example.com, other@example.com', new Set(['qa@example.com'])), false);
  assert.deepEqual(emailAddresses('QA@example.com, invalid'), ['qa@example.com']);
});

test('live Slack sends accept only named test channels or configured channel IDs', () => {
  assert.equal(isAllowedTestChannel('#ax테스트', new Set()), true);
  assert.equal(isAllowedTestChannel('C123TEST', new Set(['C123TEST'])), true);
  assert.equal(isAllowedTestChannel('C123OTHER', new Set(['C123TEST'])), false);
});
