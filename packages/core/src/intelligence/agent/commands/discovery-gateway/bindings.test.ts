import { describe, expect, it } from 'vitest';
import type { AxCommand } from '../schema.js';
import { DiscoverySessionBindings } from './bindings.js';

const started = ['ok', { sessionId: 'discovery-1', status: 'exploring' }] as const;
const cancel = (sessionId?: string): AxCommand => ({
  name: 'discovery.cancel',
  args: sessionId === undefined ? {} : { sessionId },
});

describe('DiscoverySessionBindings', () => {
  it('lets the starting workspace session act on its own discovery session', () => {
    const bindings = new DiscoverySessionBindings();
    bindings.record([...started], { workspaceSessionId: 'chat-a' });
    expect(bindings.reject(cancel('discovery-1'), { workspaceSessionId: 'chat-a' })).toBeUndefined();
  });

  it('rejects another workspace session with the same result as an unknown id', () => {
    const bindings = new DiscoverySessionBindings();
    bindings.record([...started], { workspaceSessionId: 'chat-a' });
    const foreign = bindings.reject(cancel('discovery-1'), { workspaceSessionId: 'chat-b' });
    const unknown = bindings.reject(cancel('discovery-unknown'), { workspaceSessionId: 'chat-b' });
    expect(foreign?.[0]).toBe('not_found');
    expect(foreign).toEqual(unknown);
  });

  it('fails closed for workspace callers on sessions started without a workspace session', () => {
    const bindings = new DiscoverySessionBindings();
    bindings.record([...started], {});
    expect(bindings.reject(cancel('discovery-1'), { workspaceSessionId: 'chat-a' })?.[0]).toBe('not_found');
  });

  it('keeps the dedicated discovery UI path (no workspace session) and argument validation unchanged', () => {
    const bindings = new DiscoverySessionBindings();
    bindings.record([...started], { workspaceSessionId: 'chat-a' });
    expect(bindings.reject(cancel('discovery-1'), {})).toBeUndefined();
    expect(bindings.reject(cancel(), { workspaceSessionId: 'chat-a' })).toBeUndefined();
  });

  it('does not bind failed starts', () => {
    const bindings = new DiscoverySessionBindings();
    bindings.record(['invalid', { sessionId: 'discovery-1' }], { workspaceSessionId: 'chat-a' });
    expect(bindings.reject(cancel('discovery-1'), { workspaceSessionId: 'chat-a' })?.[0]).toBe('not_found');
  });
});
