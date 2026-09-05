// Synthetic provider contract smoke: no user PDF, source service or hidden gold.
import { CodexCliProvider } from '../packages/core/dist/agent/model/cli/adapters/codex-cli.js';
import { ReportCalculationInferenceSchema, ReportLayoutInferenceSchema } from '../packages/core/dist/report-generation/planner/schema.js';

const provider = new CodexCliProvider('gpt-5.6-luna');
const calculation = await provider.generateStructured({
  schema: ReportCalculationInferenceSchema, system: 'Return the requested structured object only. Do not use tools.',
  user: 'Create schemaVersion 1 with reportPlan schemaVersion 1, baseSource ledger, no joins, one scalar n with count expression, no format, no tables, no texts. This is a synthetic schema test.',
  timeoutMs: 180000, codexReasoningEffort: 'low',
});
const layout = await provider.generateStructured({
  schema: ReportLayoutInferenceSchema, system: 'Return the requested structured object only. Do not use tools.',
  user: 'Create schemaVersion 1 and layout schemaVersion 1, outputFileName report.pdf, one scalarBinding slotId total binding kind scalar id n, no tableBindings. This is a synthetic schema test.',
  timeoutMs: 180000, codexReasoningEffort: 'low',
});
if (calculation.reportPlan.scalars[0]?.expression.kind !== 'count'
    || layout.layout.scalarBindings[0]?.slotId !== 'total') throw new Error('Unexpected synthetic output');
console.log(JSON.stringify({ calculationContract: 'passed', layoutContract: 'passed' }));
