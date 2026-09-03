import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import type { HttpConnectionConfig, HttpEndpoint } from './connection.js';
import { executeHttpAction } from './connector/execute.js';
import { normalizeHttpEndpoints } from './connector/config.js';

export class HttpConnector implements Connector {
  name = 'http';
  private readonly endpoints: HttpEndpoint[];

  constructor(config: HttpConnectionConfig | readonly HttpEndpoint[]) {
    this.endpoints = normalizeHttpEndpoints(config);
  }

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    return executeHttpAction(this.endpoints, action, params, ctx);
  }
}
