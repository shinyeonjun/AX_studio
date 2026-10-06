import { describe, expect, it } from 'vitest';
import { approvalParamsHash, redactedApprovalParams, redactedApprovalSnapshot } from './approval-snapshot.js';

describe('redactedApprovalSnapshot', () => {
  it('reports no truncation for short params', () => {
    expect(redactedApprovalSnapshot({ channel: '#ops', text: 'hi' })).toEqual({ params: { channel: '#ops', text: 'hi' } });
  });

  it('marks shortened strings with their path and original length', () => {
    const text = 'x'.repeat(1_200);
    const snapshot = redactedApprovalSnapshot({ text, nested: { body: text } });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.truncatedFields).toEqual([
      { path: 'text', originalLength: 1_200 },
      { path: 'nested.body', originalLength: 1_200 },
    ]);
    expect((snapshot.params.text as string).length).toBe(501);
    expect(redactedApprovalParams({ text })).toEqual({ text: snapshot.params.text });
  });

  it('marks shortened arrays and keeps the hash over the full payload', () => {
    const items = Array.from({ length: 70 }, (_, index) => index);
    const snapshot = redactedApprovalSnapshot({ items });
    expect(snapshot.truncatedFields).toEqual([{ path: 'items', originalLength: 70 }]);
    expect(approvalParamsHash({ items })).not.toBe(approvalParamsHash(snapshot.params));
  });

  it('redacts sensitive keys without reporting truncation', () => {
    expect(redactedApprovalSnapshot({ apiKey: 'y'.repeat(900) })).toEqual({ params: { apiKey: '[redacted]' } });
  });
});
