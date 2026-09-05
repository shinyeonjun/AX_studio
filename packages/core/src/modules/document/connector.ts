import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { getDocumentHandler } from './registry.js';
import type { DocumentActionHandler } from './types.js';

export class DocumentConnector implements Connector {
  name = 'document';

  constructor(private readonly overrides: Record<string, DocumentActionHandler> = {}) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const handler = this.overrides[action] ?? getDocumentHandler(action);
    if (!handler) {
      return { ok: false, error: `Unknown document action: ${action}` };
    }
    return handler(params, ctx);
  }
}
