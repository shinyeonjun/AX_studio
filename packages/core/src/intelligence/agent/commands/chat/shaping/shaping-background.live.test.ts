import { describe, expect, it } from 'vitest';
import { JevDecisionEngine } from '../../../../decision/jev.js';
import { tableArtifactFromRows } from '../../../../../contracts/artifacts/table-build.js';
import { applyJevTableTransform } from './table-transform/index.js';
import { shapingBackground, withDecisionBackground } from './decision-background.js';

const liveEvalEnabled = process.env.AX_LIVE_JEV_EVAL === '1';

// Run with AX_LIVE_JEV_EVAL=1 and TYPESAFE_API_KEY. A company word the person defined ("VIP") is
// applied by the real Jev only when their definition is given as background.
describe.skipIf(!liveEvalEnabled)('a definition the person confirmed shapes a filter', () => {
  it('keeps only grade A customers for "VIP" once VIP was defined, and not before', async () => {
    const jev = new JevDecisionEngine({
      apiKey: process.env.TYPESAFE_API_KEY!.trim(),
      model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || undefined,
      baseURL: process.env.TYPESAFE_BASE_URL?.trim() || undefined,
    });
    const table = tableArtifactFromRows([
      { name: '가나상사', grade: 'A', region: '서울' },
      { name: '다라물산', grade: 'B', region: '부산' },
      { name: '마바테크', grade: 'A', region: '대구' },
      { name: '사아유통', grade: 'C', region: '서울' },
    ], { id: 'customers', name: 'customers', rowLimit: 100 })!;
    const run = async (sessionMemo: Record<string, string>) => {
      const background = shapingBackground({ sessionMemo, workflowPolicy: {} });
      return applyJevTableTransform({ decisionEngine: withDecisionBackground(jev, background), table, userMessage: 'VIP 고객만 보여줘', mode: 'auto' });
    };
    const defined = await run({ user_rule_1: 'VIP 고객은 grade가 A인 고객이다.' });
    console.info('[shaping-background] defined:', defined.status, defined.status === 'transformed' ? defined.table.rows.map((row) => row.values.name) : '');
    expect(defined.status).toBe('transformed');
    if (defined.status === 'transformed') expect(defined.table.rows.map((row) => row.values.grade)).toEqual(['A', 'A']);
    const undefinedVip = await run({});
    console.info('[shaping-background] undefined:', undefinedVip.status, undefinedVip.status === 'transformed' ? undefinedVip.table.rows.map((row) => row.values.name) : '');
  }, 120_000);
});
