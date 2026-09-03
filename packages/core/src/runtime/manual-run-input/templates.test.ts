import { describe, expect, it } from 'vitest';
import { resolveStepParams } from '../ai-investigation.js';
import type { ConnectorContext } from '../../modules/types.js';

describe('resolveStepParams templates', () => {
  it('resolves bare filePath from execution variables', () => {
    const ctx: ConnectorContext = {
      executionId: 'exec-1',
      variables: { filePath: 'D:\\docs\\sample.pdf' },
      log: () => {},
    };
    const resolved = resolveStepParams({ path: '{{filePath}}' }, ctx, {});
    expect(resolved.path).toBe('D:\\docs\\sample.pdf');
  });
});
