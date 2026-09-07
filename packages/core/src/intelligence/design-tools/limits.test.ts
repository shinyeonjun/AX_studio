import { describe, expect, it } from 'vitest';
import { buildDesignToolContext, executeDesignToolCalls, formatDesignToolResults } from './index.js';

describe('design-tools call and result limits', () => {
  it('bounds tool calls and returned tool context', async () => {
    await expect(
      executeDesignToolCalls(
        Array.from({ length: 6 }, () => ({ tool: 'connections.list' as const })),
        buildDesignToolContext([], []),
      ),
    ).rejects.toThrow('too_many_design_tool_calls:5');

    const formatted = formatDesignToolResults([
      { tool: 'sources.file.read', ok: true, data: 'x'.repeat(70_000) },
    ]);
    expect(formatted.length).toBeLessThan(60_100);
    expect(formatted).toContain('[design-tool results truncated]');
  });
});
