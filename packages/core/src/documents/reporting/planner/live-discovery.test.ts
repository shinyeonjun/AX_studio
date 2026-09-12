import { describe, expect, it } from 'vitest';
import { AgentHarness, createInvestigationRunner } from '../../../intelligence/agent/harness.js';
import { CodexCliProvider } from '../../../intelligence/agent/model/cli/adapters/codex-cli.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { ReportPlanner } from './planner.js';

// Explicit opt-in: uses a real model with synthetic evidence, never a live connector.
describe.skipIf(!process.env.AX_LIVE_DISCOVERY_MODEL)('live natural-language source discovery', () => {
  const pair: PdfReportPairAnalysis = { schemaVersion: 1, pairId: 'synthetic', templateHash: 't', exampleHash: 'e',
    pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] };
  const cases = [
    { name: 'sufficient', sufficient: true, goal: '2037년 1월이 예시 기간이고 다음 보고서는 2037년 2월이야. warehouse.events의 기록을 같은 기준으로 정리해줘. 날짜는 recorded_at이고 금액은 amount야. 읽기만 하고 외부 전송은 하지 마.', start: '2037-02-01', end: '2037-02-28' },
    { name: 'ambiguous', sufficient: false, goal: '그거 지난번에 하던 것처럼 이번 것도 알아서 정리해줘.' },
    { name: 'corrected-month', sufficient: true, goal: 'warehouse.events로 매출 보고서 해줘. 날짜 recorded_at, 금액 amount이고 예시는 2037년 1월이야. 이번 건 2월로... 아니 내가 잘못 말했네, 3월 전체로 해줘. 조회만 하고 전송이나 변경은 금지야.', start: '2037-03-01', end: '2037-03-31' },
    { name: 'leap-month', sufficient: true, goal: '2036년 1월 예시와 같은 기준으로 바로 다음 달 한 달치를 보고 싶어. 원천은 warehouse.events, 날짜는 recorded_at, 금액은 amount야. 윤년 마지막 날짜까지 빠짐없이 포함해. 조회만 해줘.', start: '2036-02-01', end: '2036-02-29' },
    { name: 'missing-source-and-period', sufficient: false, goal: '매출인지 입금액인지 나도 잘 모르겠는데 아무 자료나 골라서 이번 거 만들어줘. 모르는 숫자는 채우지 말고 필요한 건 먼저 물어봐.' },
  ];
  it.each(cases)('$name evidence', async scenario => {
    const harness = new AgentHarness(new CodexCliProvider(process.env.AX_LIVE_DISCOVERY_MODEL!));
    const planner = new ReportPlanner(createInvestigationRunner(harness));
    try {
      const result = planner.inferCapturePlan({ pair, httpConnections: [], connectedConnectors: ['rdb'],
        rdbTables: scenario.sufficient ? ['warehouse.events'] : [],
        goal: scenario.goal,
        requirements: scenario.sufficient ? [{ id: 'records', connector: 'rdb', description: 'warehouse.events 기록', reason: '사용자가 지정한 원천' }] : [],
        inspectSource: async request => {
          if (request.kind !== 'rdb_table' || request.table !== 'warehouse.events') throw new Error('unauthorized_synthetic_inspection');
          return { columns: [{ name: 'recorded_at', type: 'date' }, { name: 'amount', type: 'numeric' }], complete: true };
        },
      });
      if (!scenario.sufficient) await expect(result).rejects.toThrow('report_source_discovery_needs_input');
      else {
        const plan = await result;
        expect(plan.capturePlan.http).toEqual([]);
        expect(plan.capturePlan.rdb).toHaveLength(1);
        expect(plan.capturePlan.rdb[0]!.table).toBe('warehouse.events');
        expect(plan.targetPeriod).toMatchObject({ start: scenario.start, endInclusive: scenario.end });
        expect(plan.requirementBindings?.[0]?.requirementId).toBe('records');
      }
    } finally { await harness.dispose(); }
  }, 200_000);
});
