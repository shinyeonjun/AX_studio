import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { executeTransformAction } from './connector/execute.js';

export class TransformConnector implements Connector {
  name = 'transform';

  async execute(
    action: string,
    params: Record<string, unknown>,
    ctx: ConnectorContext,
  ): Promise<ConnectorResult> {
    return executeTransformAction(action, params, ctx);
  }
}
