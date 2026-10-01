import { describe, expect, it } from 'vitest';
import { normalizeDocumentEngineError } from './request.js';

describe('normalizeDocumentEngineError', () => {
  it('replaces Python dependency details with a stable recovery code', () => {
    expect(normalizeDocumentEngineError("No module named 'pymupdf'"))
      .toBe('document_engine_dependency_missing');
    expect(normalizeDocumentEngineError("ModuleNotFoundError: No module named 'reportlab'"))
      .toBe('document_engine_dependency_missing');
  });

  it('leaves non-dependency errors unchanged', () => {
    expect(normalizeDocumentEngineError('document_engine_timeout')).toBe('document_engine_timeout');
  });
});
