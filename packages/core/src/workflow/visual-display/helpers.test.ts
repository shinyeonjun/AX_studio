import { describe, expect, it } from 'vitest';
import { paramValue } from './helpers.js';

describe('a step parameter on the canvas', () => {
  it('reads as words, never as an object or a template', () => {
    const expr = { op: 'aggregate', fn: 'sum', column: '금액', input: { op: 'source', sourceId: 's' } };
    expect(paramValue({ expr }, 'expr')).toBe('금액 합계');
    expect(paramValue({ path: '{{sourcePath}}' }, 'path')).toBe('실행할 때 채워짐');
    expect(paramValue({ options: { a: 1 } }, 'options')).toBe('설정됨');
    expect(paramValue({ channel: ' #ops ' }, 'channel')).toBe('#ops');
    expect(paramValue({ count: 3 }, 'count')).toBe('3');
  });
});
