import { describe, expect, it } from 'vitest';
import { MAX_DECISION_CHOICE_CRITERIA, type DecisionAnswer } from '../../../../contracts/decision.js';
import type { WorkspaceSourceRecord } from '../../../../persistence/workspace-source-service.js';
import {
  reportCommand,
  reportSourceQuestions,
  reportSources,
} from './jev-report-selection.js';

function source(
  id: string,
  fileName: string,
  status: WorkspaceSourceRecord['status'] = 'ready',
): WorkspaceSourceRecord {
  return { id, sessionId: 'chat-1', artifactId: id, fileName, status, createdAt: '', updatedAt: '' };
}

function answersFor(
  candidates: readonly WorkspaceSourceRecord[],
  templateId: string,
  exampleId: string,
): Record<string, DecisionAnswer> {
  return Object.fromEntries(candidates.map((candidate, index) => {
    const choice = candidate.id === templateId ? 'template'
      : candidate.id === exampleId ? 'example' : 'none';
    return [`report_source_role_${index}`, {
      type: 'choice' as const,
      choice,
      probabilities: { [choice]: 0.95 },
      confidence: 0.95,
    }];
  }));
}

describe('report source selection', () => {
  it('includes every ready PDF without applying Jev choice-option limits', () => {
    const candidates = Array.from(
      { length: MAX_DECISION_CHOICE_CRITERIA + 45 },
      (_, index) => source(`pdf-${index}`, `report-${index}.pdf`),
    );
    const selection = reportSources([
      source('processing', 'processing.pdf', 'processing'),
      source('text', 'notes.txt'),
      ...candidates,
    ]);

    expect(selection.catalogSize).toBe(candidates.length);
    expect(selection.candidates).toHaveLength(candidates.length);
    expect(selection.candidates.at(-1)?.id).toBe(`pdf-${candidates.length - 1}`);
  });

  it('asks Jev for one three-way role classification per source', () => {
    const candidates = [source('template', 'blank.pdf'), source('example', 'completed.pdf')];
    const questions = reportSourceQuestions(candidates);

    expect(Object.keys(questions)).toEqual(['report_source_role_0', 'report_source_role_1']);
    expect(questions.report_source_role_0).toMatchObject({
      type: 'choice',
      instructions: {
        candidate: { id: 'template', file_name: 'blank.pdf' },
        task: expect.stringContaining('blank template'),
      },
      criteria: {
        template: expect.stringContaining('blank'),
        example: expect.stringContaining('completed'),
        none: expect.any(String),
      },
    });
  });

  it('compiles a report command only when one valid source fills each distinct role', () => {
    const candidates = [source('template', 'blank.pdf'), source('example', 'completed.pdf')];

    expect(reportCommand({
      hasWorkspaceSession: true,
      userMessage: '보고서를 만들어줘',
      candidates,
      answers: answersFor(candidates, 'template', 'example'),
    })).toEqual({
      name: 'report.generate',
      args: {
        goal: '보고서를 만들어줘',
        templateSourceId: 'template',
        exampleSourceId: 'example',
      },
    });
  });

  it('trusts listed source-role choices but rejects missing, ambiguous, invalid, or reused answers', () => {
    const candidates = [source('template', 'blank.pdf'), source('example', 'completed.pdf')];
    const base = { hasWorkspaceSession: true, userMessage: '보고서를 만들어줘', candidates };
    const valid = answersFor(candidates, 'template', 'example');

    expect(reportCommand({ ...base, answers: {} })).toEqual({ kind: 'fallback', reason: 'uncertain' });
    expect(reportCommand({
      ...base,
      answers: answersFor(candidates, 'template', 'template'),
    })).toEqual({ kind: 'fallback', reason: 'uncertain' });

    const lowConfidence = { ...valid,
      report_source_role_0: { type: 'choice', choice: 'template', probabilities: { template: 0.7 }, confidence: 0.7 } as const };
    expect(reportCommand({ ...base, answers: lowConfidence })).toEqual(reportCommand({ ...base, answers: valid }));

    const ambiguous = { ...valid,
      report_source_role_1: { type: 'choice', choice: 'template', probabilities: { template: 0.91 }, confidence: 0.91 } as const };
    expect(reportCommand({ ...base, answers: ambiguous })).toEqual({ kind: 'fallback', reason: 'uncertain' });

    const invalid = { ...valid,
      report_source_role_0: { type: 'choice', choice: 'unknown', probabilities: { unknown: 1 }, confidence: 1 } as const };
    expect(reportCommand({ ...base, answers: invalid })).toEqual({ kind: 'fallback', reason: 'uncertain' });
  });

  it('requires a workspace session and at least two sources before generating', () => {
    expect(reportCommand({
      hasWorkspaceSession: false,
      userMessage: '보고서',
      answers: {},
      candidates: [source('template', 'blank.pdf'), source('example', 'done.pdf')],
    })).toEqual({ kind: 'fallback', reason: 'missing_context' });
  });
});
