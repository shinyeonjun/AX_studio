import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { getDocumentHandler } from './registry.js';

export class DocumentConnector implements Connector {
  name = 'document';

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const handler = getDocumentHandler(action);
    if (!handler) {
      return { ok: false, error: `Unknown document action: ${action}` };
    }
    return handler(params, ctx);
  }
}
