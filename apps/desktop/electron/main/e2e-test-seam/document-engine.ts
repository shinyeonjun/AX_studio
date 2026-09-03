import { basename } from 'node:path';
import {
  MockDocumentEngineClient,
  type IngestDocumentOptions,
  type IngestDocumentResult,
} from '@ax-studio/core';
import { pauseForDocumentEngineCheck } from './timing.js';

export class E2EDocumentEngineClient extends MockDocumentEngineClient {
  override async ingest(
    path: string,
    options: IngestDocumentOptions = {},
  ): Promise<IngestDocumentResult> {
    await pauseForDocumentEngineCheck();
    if (basename(path).toLowerCase().includes('failure')) {
      throw new Error('e2e_document_ingest_failure');
    }
    const result = await super.ingest(path, options);
    return {
      ...result,
      engine: 'mock-e2e',
      summary: { ...result.summary, engine: 'mock-e2e' },
    };
  }
}
