import { expect, it } from 'vitest';
import { buildTableArtifact } from '../contracts/artifacts/table-build.js';
import { materializeStepOutputs } from './output-ports.js';

it('preserves a direct typed table when the declared output port is named rows', () => {
  const table = buildTableArtifact({ id: 'rdb', headers: ['id', 'product'], matrix: [[3, '노트'], [1, '{{data}}']] });
  table.truncated = true; table.source = { table: 'orders' };
  expect(materializeStepOutputs('read', { rows: 'TableArtifact' }, table)).toEqual({ rows: { ...table, completeness: { ...table.completeness, status: 'partial', reason: 'provider_limit' } } });
});
it('continues to unwrap a port envelope and normalize ordinary row arrays', () => {
  const table = buildTableArtifact({ id: 'rdb', headers: ['id'], matrix: [[3]] });
  expect(materializeStepOutputs('read', { rows: 'TableArtifact' }, { rows: table })).toEqual({ rows: table });
  const output = materializeStepOutputs('read', { rows: 'TableArtifact' }, { rows: [{ id: 3 }] }) as { rows: typeof table };
  expect(output.rows.rows[0]?.values).toEqual({ id: 3 });
});
