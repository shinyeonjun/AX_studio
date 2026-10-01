import { describe, expect, it } from 'vitest';
import { errorMessage } from './validation.js';

describe('workspace source errors', () => {
  it('shows the project-venv setup command when document-engine packages are missing', () => {
    const message = errorMessage('document_engine_dependency_missing');
    expect(message).toContain('AX_DOCUMENT_ENGINE_PYTHON');
    expect(message).toContain('npm run document-engine:setup');
  });
});
