import type { ConnectorContext, ConnectorResult } from '../types.js';

export type DocumentActionHandler = (
  params: Record<string, unknown>,
  ctx: ConnectorContext,
) => Promise<ConnectorResult>;
