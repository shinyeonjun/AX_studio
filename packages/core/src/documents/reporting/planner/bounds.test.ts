import { describe, expect, it, vi } from 'vitest';
import type { DecisionEngine } from '../../../contracts/decision.js';
import type { InvestigationRunner, InvestigationRunRequest } from '../../../intelligence/agent/investigation-runner.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { ReportPlanner } from './planner.js';
import { ReportSourceRequirementsSchema } from './schema.js';

const pair: PdfReportPairAnalysis = { schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
  pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] };
const context = { goal: 'Create a report', pair, connectedConnectors: ['rdb'] };

describe('source planning bounds', () => {
  it('rejects oversized report geometry before calling the model or loading images', async () => {
    const run = vi.fn();
    const readImage = vi.fn();
    const planner = new ReportPlanner({ providerName: 'test', run }, { maxPlanningChars: 1_000, readImage });
    await expect(planner.inferCapturePlan({ ...context, pair: { ...pair, scalarSlots: [{ id: 'slot', pageIndex: 0,
      rect: { x: 0, y: 0, width: 10, height: 10 }, exampleText: 'x'.repeat(2_000), font: 'Helvetica', fontSize: 10, color: 0 }] },
      httpConnections: [], rdbTables: [] }))
      .rejects.toThrow('report_planning_context_too_large');
    expect(run).not.toHaveBeenCalled();
    expect(readImage).not.toHaveBeenCalled();
  });

  it('preserves the configured context bound after source inspection adds evidence', async () => {
    let calls = 0;
    const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
      calls++;
      return { output: request.outputSchema.parse(calls === 1
        ? { schemaVersion: 1, status: 'need_evidence', request: { kind: 'rdb_table', table: 'records' } }
        : { schemaVersion: 1, status: 'needs_input', reason: 'Stop' }) };
    } };
    const planner = new ReportPlanner(runner, { maxPlanningChars: 1_000 });
    await expect(planner.inferCapturePlan({ ...context, httpConnections: [], rdbTables: ['records'],
      inspectSource: async () => ({ columns: [{ name: 'amount', description: 'x'.repeat(1_000) }] }) }))
      .rejects.toThrow('report_planning_context_too_large');
    expect(calls).toBe(1);
  });

  it.each([1, 2])('does not load report images for typed source selection (%s pages)', async count => {
    const run = vi.fn();
    const readImage = vi.fn(() => new Uint8Array(1024));
    const evaluate = vi.fn<DecisionEngine['evaluate']>(async ({ questions }) => ({ answers:
      Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'choice' as const, choice: 'required',
        probabilities: { required: 0.4, not_required: 0.35, unclear: 0.25 }, confidence: 0.4 }])) }));
    const planner = new ReportPlanner({ providerName: 'test', run },
      { readImage, decisionEngine: { evaluate } });
    await expect(planner.inferSourceRequirements({ ...context, pair: { ...pair,
      templateImages: ['template.png'], exampleImages: count === 2 ? ['example.png'] : [] } }))
      .resolves.toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(readImage).not.toHaveBeenCalled();
  });

  it('keeps the semantic requirement count bounded without dropping requirements', () => {
    const requirements = Array.from({ length: 13 }, (_, index) => ({ id: `need-${index}`, connector: 'rdb',
      description: `Business requirement ${index}`, reason: 'Explicit user requirement' }));
    expect(ReportSourceRequirementsSchema.safeParse({ schemaVersion: 1, requirements }).success).toBe(false);
    expect(ReportSourceRequirementsSchema.parse({ schemaVersion: 1, requirements: requirements.slice(0, 12) }).requirements).toHaveLength(12);
  });
});
