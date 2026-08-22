import { describe, expect, it } from 'vitest';
import { buildInvestigationUser } from '../../../runtime/ai-investigation.js';

describe('investigate prompt includes memo', () => {
  it('adds criteria block from ai_decision memo', () => {
    const text = buildInvestigationUser(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: 'PDF 위험도 분류',
        memo: 'critical=즉시 대응',
        investigation: false,
        maxReads: 1,
      },
      { variables: {}, executionId: 'exec-1' },
      {},
    );

    expect(text).toContain('Criteria:');
    expect(text).toContain('critical=즉시 대응');
  });

  it('carries document image metadata and OCR into the analysis input', () => {
    const text = buildInvestigationUser(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: 'PDF 위험도 분류',
        investigation: false,
        maxReads: 1,
      },
      { variables: {}, executionId: 'exec-1' },
      {
        ingest: {
          images: [{ pageIndex: 2, path: 'C:/artifacts/page-3.png', ocrText: '긴급 조치 필요' }],
        },
      },
    );

    expect(text).toContain('Document visuals');
    expect(text).toContain('page=2');
    expect(text).toContain('긴급 조치 필요');
    expect(text).toContain('visualContent=ocr_only');
  });

  it('marks visual-only pages as unavailable instead of implying vision input', () => {
    const text = buildInvestigationUser(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: 'PDF 위험도 분류',
        investigation: false,
        maxReads: 1,
      },
      { variables: {}, executionId: 'exec-1' },
      { ingest: { pages: [{ index: 0, hasVisual: true, imagePath: 'C:/artifacts/page-1.png' }] } },
    );

    expect(text).toContain('visualContent=visual_content_unavailable');
  });
});
