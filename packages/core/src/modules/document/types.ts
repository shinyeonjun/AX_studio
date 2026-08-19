import type { ConnectorContext, ConnectorResult } from '../types.js';

/** Supported document backends under the Document connector. */
export type DocumentFormat = 'html' | 'docx' | 'pdf' | 'txt' | 'markdown' | 'google-drive' | 'notion';

export type DocumentActionHandler = (
  params: Record<string, unknown>,
  ctx: ConnectorContext,
) => Promise<ConnectorResult>;

export interface DocumentFormatModule {
  format: DocumentFormat;
  /** action suffix after `${format}.` — e.g. render, fill, generate, read */
  actions: Record<string, DocumentActionHandler>;
}
