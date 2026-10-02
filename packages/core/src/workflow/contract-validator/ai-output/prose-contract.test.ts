import { afterEach, describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../../contract-validator.js';
import { PROSE_OUTPUT_SCHEMA } from '../../ai-output-contract.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../../catalog/dynamic-catalog.js';
import type { Step, WorkflowIR } from '../../schema.js';

const draft: Extract<Step, { type: 'ai_decision' }> = {
  type: 'ai_decision', id: 'draft', goal: '한국어 문안', investigation: false, outputSchema: PROSE_OUTPUT_SCHEMA,
};
function workflow(steps: Step[]): WorkflowIR {
  return { name: 'Output contract', goal: 'Prose has no authority', version: 1, steps, inputs: [],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {} };
}
function action(connector: string, name: string, params: Record<string, unknown>, id = 'next'): Extract<Step, { type: 'action' }> {
  return { type: 'action', id, connector, action: name, params, sideEffect: connector === 'document' ? 'REVERSIBLE' : 'NONE' };
}
function boundaryIssues(ir: WorkflowIR) {
  return validateWorkflowContracts(ir).filter((issue) => issue.code === 'invalid_workflow_schema' || issue.code === 'invalid_workflow_reference');
}
afterEach(clearDynamicCatalogForTests);

describe('explicit prose output contract', () => {
  it.each([
    ['slack', 'message.send', 'channel'], ['gmail', 'message.send', 'to'],
    ['document', 'ingest', 'path'], ['http', 'request', 'connectionId'],
    ['slack', 'messages.search', 'query'], ['transform', 'evaluate', 'expr'],
    ['transform', 'evaluate', 'table'], ['document', 'html.render', 'template'],
    ['document', 'pdf.generate', 'html'],
  ])('blocks prose in %s.%s.%s', (connector, name, port) => {
    const target = action(connector, name, { [port]: '{{draft.conclusion}}' });
    expect(boundaryIssues(workflow([draft, target]))).toContainEqual(expect.objectContaining({
      stepId: 'draft', message: expect.stringContaining('purpose:prose'),
    }));
  });

  it.each(['result', 'approved', 'conclusion.path', ''])('blocks aggregate, undeclared and nested references: %s', (field) => {
    const reference = field ? `draft.${field}` : 'draft';
    const target = { ...action('slack', 'message.send', { channel: '#fixture', text: `{{${reference}}}` }), sideEffect: 'EXTERNAL' as const };
    expect(boundaryIssues(workflow([draft, target]))).toContainEqual(expect.objectContaining({ code: 'invalid_workflow_reference' }));
  });

  it('does not grant content permission from TextArtifact or a text UI control', () => {
    registerDynamicCapabilities([{ id: 'fixture.search', connector: 'fixture', kind: 'read', label: 'Search', description: 'Filter rows',
      params: [{ name: 'query', label: 'Query', question: 'Query', required: true, inputType: 'text' }],
      io: { inputs: { query: 'TextArtifact' }, outputs: { rows: 'TableArtifact' } } }]);
    const target = action('fixture', 'search', { query: '{{draft.conclusion}}' });
    expect(boundaryIssues(workflow([draft, target]))).toContainEqual(expect.objectContaining({ message: expect.stringContaining('next.query') }));
  });

  it('blocks a prose field in branches and approval targets', () => {
    const ir = workflow([draft,
      { type: 'if', id: 'route', condition: { op: 'eq', left: { ref: 'draft.conclusion' }, right: { lit: 'approved' } }, thenStepIds: [] },
      { type: 'human_approval', id: 'approve', reason: 'Review', forActionIds: ['{{draft.conclusion}}'] },
    ]);
    expect(boundaryIssues(ir).filter((issue) => issue.stepId === 'draft')).toHaveLength(2);
  });

  it('blocks a model field in connector/tool selection', () => {
    const ir = workflow([draft, action('{{draft.conclusion}}', '{{draft.conclusion}}', {})]);
    expect(boundaryIssues(ir)).toContainEqual(expect.objectContaining({ stepId: 'draft', message: expect.stringContaining('next.control') }));
  });

  it('blocks laundering model prose through a content action output', () => {
    const render = action('document', 'html.render', { data: { summary: '{{draft.conclusion}}' } }, 'render');
    const search = action('document', 'search', { query: { ref: 'render.html' } });
    search.sideEffect = 'NONE';
    expect(boundaryIssues(workflow([draft, render, search]))).toContainEqual(expect.objectContaining({ stepId: 'render', message: expect.stringContaining('next.query') }));
  });

  it('blocks prose as evidence to a decision or an investigating step', () => {
    const target: Extract<Step, { type: 'ai_decision' }> = {
      ...draft, id: 'review', inputContracts: { sourceText: 'TextArtifact' },
      bindings: { sourceText: { from: 'draft', output: 'conclusion' } },
      outputSchema: { properties: { notify: { type: 'boolean' } }, required: ['notify'] },
    };
    expect(boundaryIssues(workflow([draft, target]))).toContainEqual(expect.objectContaining({ stepId: 'draft' }));
    expect(boundaryIssues(workflow([draft, { ...target, investigation: true, outputSchema: PROSE_OUTPUT_SCHEMA }]))).toContainEqual(expect.objectContaining({ stepId: 'draft' }));
    expect(boundaryIssues(workflow([draft, { ...target, outputSchema: PROSE_OUTPUT_SCHEMA }]))).toEqual([]);
  });

  it('preserves prose in mail subject/body and host-rendered document content', () => {
    const mail = { ...action('gmail', 'message.send', { to: 'fixture@example.invalid', subject: '{{draft.conclusion}}', body: '{{draft.conclusion}}' }), sideEffect: 'EXTERNAL_HIGH' as const };
    expect(boundaryIssues(workflow([draft, mail]))).toEqual([]);
    const render = action('document', 'html.render', { template: '<p>{{summary}}</p>', data: { summary: '{{draft.conclusion}}' } }, 'render');
    const pdf = action('document', 'pdf.generate', { html: '{{render.html}}' });
    expect(boundaryIssues(workflow([draft, render, pdf]))).toEqual([]);
  });

  it('does not allow an input name to shadow a model step', () => {
    const ir = { ...workflow([draft, action('document', 'search', { query: '{{draft.conclusion}}' })]), inputs: ['draft'] };
    expect(boundaryIssues(ir)).toContainEqual(expect.objectContaining({ stepId: 'draft' }));
  });
});
