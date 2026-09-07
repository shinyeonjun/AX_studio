import { describe, expect, it } from 'vitest';
import { AgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { CodexCliProvider } from '../../../intelligence/agent/model/cli/adapters/codex-cli.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { ReportPlanner } from './planner.js';

// Explicit opt-in: uses a real model with synthetic evidence, never a live connector.
describe.skipIf(!process.env.AX_LIVE_DISCOVERY_MODEL)('live natural-language source discovery', () => {
  const pair: PdfReportPairAnalysis = { schemaVersion: 1, pairId: 'synthetic', templateHash: 't', exampleHash: 'e',
    pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] };
  it.each(['sufficient', 'ambiguous'] as const)('%s evidence', async mode => {
    const harness = new AgentHarness(new CodexCliProvider(process.env.AX_LIVE_DISCOVERY_MODEL!));
    const planner = new ReportPlanner(createInvestigationRunner(harness));
    try {
      const result = planner.inferCapturePlan({ pair, httpConnections: [], connectedConnectors: ['rdb'],
        rdbTables: mode === 'sufficient' ? ['warehouse.events'] : [],
        goal: mode === 'sufficient'
          ? '2037년 1월이 예시 기간이고 다음 보고서는 2037년 2월이야. warehouse.events의 기록을 같은 기준으로 정리해줘. 날짜는 recorded_at이고 금액은 amount야. 읽기만 하고 외부 전송은 하지 마.'
          : '그거 지난번에 하던 것처럼 이번 것도 알아서 정리해줘.',
        requirements: mode === 'sufficient' ? [{ id: 'records', connector: 'rdb', description: 'warehouse.events 기록', reason: '사용자가 지정한 원천' }] : [],
        inspectSource: async request => {
          if (request.kind !== 'rdb_table' || request.table !== 'warehouse.events') throw new Error('unauthorized_synthetic_inspection');
          return { columns: [{ name: 'recorded_at', type: 'date' }, { name: 'amount', type: 'numeric' }], complete: true };
        },
      });
      if (mode === 'ambiguous') await expect(result).rejects.toThrow('report_source_discovery_needs_input');
      else {
        const plan = await result;
        expect(plan.capturePlan.http).toEqual([]);
        expect(plan.capturePlan.rdb).toHaveLength(1);
        expect(plan.capturePlan.rdb[0]!.table).toBe('warehouse.events');
        expect(plan.targetPeriod).toMatchObject({ start: '2037-02-01', endInclusive: '2037-02-28' });
        expect(plan.requirementBindings?.[0]?.requirementId).toBe('records');
      }
    } finally { await harness.dispose(); }
  }, 200_000);
});
