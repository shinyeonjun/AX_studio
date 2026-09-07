import { describe, expect, it } from 'vitest';
import {
  AgentScopedContextMapSchema,
  AgentScopedContextUpdateArgsSchema,
  mergeAgentScopedContext,
  parseStoredAgentScopedContext,
  renderAgentScopedContextBlock,
} from './scoped-context.js';

describe('agent scoped context boundary', () => {
  it('keeps dynamic policy data bounded to named string fields', () => {
    expect(AgentScopedContextMapSchema.parse({ urgency: 'critical', channel: '#ops' })).toEqual({
      urgency: 'critical',
      channel: '#ops',
    });
    expect(() => AgentScopedContextMapSchema.parse({ 'not a key': 'value' })).toThrow();
    expect(() => AgentScopedContextMapSchema.parse({ urgency: { command: 'workflow.run' } })).toThrow();
  });

  it('merges and removes fields without changing the input map', () => {
    const current = { urgency: 'normal', channel: '#ops' };
    const next = mergeAgentScopedContext(current, {
      set: { urgency: 'critical', recipient: 'ops@example.com' },
      remove: ['channel'],
    });

    expect(current).toEqual({ urgency: 'normal', channel: '#ops' });
    expect(next).toEqual({ urgency: 'critical', recipient: 'ops@example.com' });
  });

  it('fails closed for corrupt stored context and keeps the update confirmation explicit', () => {
    expect(parseStoredAgentScopedContext('{broken')).toEqual({});
    expect(AgentScopedContextUpdateArgsSchema.parse({
      scope: 'session',
      set: { audience: '운영팀' },
    })).toMatchObject({ scope: 'session', confirmed: false });
  });

  it('renders context as data with a clear non-instruction boundary', () => {
    const block = renderAgentScopedContextBlock('session memo', { criterion: '예산 초과' });
    expect(block).toContain('--- session memo ---');
    expect(block).toContain('컨텍스트 데이터');
    expect(block).toContain('예산 초과');
    expect(block).not.toContain('D:/');
  });
});
