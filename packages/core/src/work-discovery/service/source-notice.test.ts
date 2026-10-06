import { describe, expect, it } from 'vitest';

describe('telling people before a schedule re-reads an upload', () => {
  const inspect = async (sourceId: string) => {
    const { inspectDiscovery } = await import('./inspection.js');
    const { makeSession } = await import('./fixtures.js');
    const session = makeSession('s1');
    session.candidates[0]!.expr = { op: 'aggregate', input: { op: 'source', sourceId }, fn: 'sum', column: 'amount' };
    return inspectDiscovery({ store: { getDiscoverySessionState: () => session } } as never, 's1');
  };

  it('flags a rule learned from a file uploaded in chat', async () => {
    expect((await inspect('input:sales'))?.sourceNotice).toContain('다시 읽습니다');
  });

  it('says nothing for a rule that reads a connected folder', async () => {
    expect((await inspect('sheet:exports/sales_2026-08.xlsx'))?.sourceNotice).toBeUndefined();
  });
});
