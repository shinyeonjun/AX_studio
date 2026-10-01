import type { DecisionEvaluationRequest } from '../../contracts/decision.js';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthoritativeRequestError,
  authoritativeDecisionRequest,
  createAuthoritativeRequestAnchor,
  guardAuthoritativeRequestDecisions,
  resolveAuthoritativeRequestAnchor,
  verifyAuthoritativeRequestAnchor,
} from './request-anchor.js';

const question = { route: { type: 'boolean' as const, instructions: 'Requested?' } };
const rawLimit = (maxUtf8Bytes: number) => ({ maxUtf8Bytes, maxSerializedUtf8Bytes: 20_000 });

describe('exact authoritative request admission', () => {
  it('preserves all accepted text and records exact UTF-8 sizes and stable digest', () => {
    const text = `  ${'a'.repeat(2_050)} do not send or read Slack. 😀 한글 e\u0301\n`;
    const anchor = createAuthoritativeRequestAnchor(text, { originalRequestId: 'turn', workspaceSessionId: 'chat', catalogRevision: 7 });
    expect(anchor.text).toBe(text);
    expect(anchor.utf8Bytes).toBe(new TextEncoder().encode(text).byteLength);
    expect(anchor.serializedUtf8Bytes).toBe(new TextEncoder().encode(JSON.stringify({ request: text })).byteLength);
    expect(anchor.digest).toBe(createAuthoritativeRequestAnchor(text).digest);
    expect(Object.isFrozen(anchor)).toBe(true);
    expect(verifyAuthoritativeRequestAnchor(JSON.parse(JSON.stringify(anchor)))).toEqual(anchor);
  });

  it('accepts exact Unicode byte boundaries and rejects one byte or scalar over them', () => {
    expect(createAuthoritativeRequestAnchor('a'.repeat(8_192)).utf8Bytes).toBe(8_192);
    expect(() => createAuthoritativeRequestAnchor('a'.repeat(8_193))).toThrow('request_utf8_budget_exceeded');
    expect(createAuthoritativeRequestAnchor('한😀a', {}, rawLimit(8)).utf8Bytes).toBe(8);
    expect(() => createAuthoritativeRequestAnchor('한😀ab', {}, rawLimit(8))).toThrow('request_utf8_budget_exceeded');
    expect(() => createAuthoritativeRequestAnchor('한😀a😀', {}, rawLimit(8))).toThrow('request_utf8_budget_exceeded');
    expect(() => createAuthoritativeRequestAnchor('\uD83D')).toThrow('invalid_request_text');
  });

  it('counts JSON escaping separately from raw UTF-8 and never truncates to fit', () => {
    const text = 'x' + '\u0001'.repeat(12);
    const serialized = new TextEncoder().encode(JSON.stringify({ request: text })).byteLength;
    expect(createAuthoritativeRequestAnchor(text, {}, { maxSerializedUtf8Bytes: serialized }).text).toBe(text);
    expect(() => createAuthoritativeRequestAnchor(text, {}, { maxSerializedUtf8Bytes: serialized - 1 }))
      .toThrow('request_serialized_budget_exceeded');
    expect(() => createAuthoritativeRequestAnchor('x', {}, { maxUtf8Bytes: NaN })).toThrow('invalid_request_budget');
  });

  it('keeps origin and digest during continuation and rejects changed tail/version/session', () => {
    const text = 'a'.repeat(2_000) + ' do not send';
    const original = createAuthoritativeRequestAnchor(text, { originalRequestId: 'original', workspaceSessionId: 'chat', catalogRevision: 1 });
    expect(resolveAuthoritativeRequestAnchor(text, original, { originalRequestId: 'continuation', workspaceSessionId: 'chat', catalogRevision: 2 }))
      .toEqual(original);
    expect(() => resolveAuthoritativeRequestAnchor(text + ' now', original)).toThrow('request_anchor_mismatch');
    expect(() => resolveAuthoritativeRequestAnchor(text, original, { workspaceSessionId: 'other' })).toThrow('request_anchor_mismatch');
    expect(() => verifyAuthoritativeRequestAnchor({ ...original, version: 2 })).toThrow('request_anchor_mismatch');
    expect(() => verifyAuthoritativeRequestAnchor({ ...original, digest: 'sha256:' + '0'.repeat(64) })).toThrow('request_anchor_mismatch');
  });

  it('refuses a complete serialized packet before the underlying evaluator is called', async () => {
    const anchor = createAuthoritativeRequestAnchor('Exact request 😀');
    const packet = { state: { metadata: 'm'.repeat(200) }, questions: question };
    const complete = authoritativeDecisionRequest(packet, anchor);
    const size = new TextEncoder().encode(JSON.stringify({ state: complete.state, questions: complete.questions })).byteLength;
    const evaluate = vi.fn(async (_request: DecisionEvaluationRequest) => ({ answers: {} }));
    await guardAuthoritativeRequestDecisions({ evaluate }, anchor, { maxDecisionPacketUtf8Bytes: size }).evaluate(packet);
    expect(evaluate).toHaveBeenCalledTimes(1);
    evaluate.mockClear();
    await expect(guardAuthoritativeRequestDecisions({ evaluate }, anchor, { maxDecisionPacketUtf8Bytes: size - 1 }).evaluate(packet))
      .rejects.toMatchObject({ failure: { code: 'decision_packet_budget_exceeded' }, providerRequestCount: 0 });
    expect(evaluate).not.toHaveBeenCalled();
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => authoritativeDecisionRequest({ state: circular, questions: question }, anchor)).toThrow(AuthoritativeRequestError);
  });

  it('reuses a guard without layering stale intent and honors an already canceled signal', async () => {
    const evaluate = vi.fn(async (_request: DecisionEvaluationRequest) => ({ answers: {} }));
    const old = guardAuthoritativeRequestDecisions({ evaluate }, createAuthoritativeRequestAnchor('endpoint choice'));
    const current = guardAuthoritativeRequestDecisions(old, createAuthoritativeRequestAnchor('original HTTP request: do not send'));
    await current.evaluate({ state: {}, questions: question });
    expect(evaluate.mock.calls[0]?.[0]).toMatchObject({ state: { request: 'original HTTP request: do not send' } });
    evaluate.mockClear();
    const controller = new AbortController(); controller.abort();
    await expect(current.evaluate({ state: {}, questions: question, signal: controller.signal })).rejects.toBeDefined();
    expect(evaluate).not.toHaveBeenCalled();
  });
});
