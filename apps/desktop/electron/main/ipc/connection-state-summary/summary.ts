import type { ConnectionSummaryEntry, ConnectionSummaryOptions } from './contracts.js';
import { summarizeGmailConnection, summarizeHttpConnection, summarizeWebhookConnection } from './providers.js';
import { summarizeRdbConnection } from './rdb.js';

export async function summarizeConnection(
  connector: string,
  connected: boolean,
  config: Record<string, unknown> | undefined,
  options: ConnectionSummaryOptions = {},
): Promise<Record<string, unknown>> {
  if (connector === 'gmail') return summarizeGmailConnection(connected, config);
  if (connector === 'http') return summarizeHttpConnection(connected, config);
  if (connector === 'webhook') return summarizeWebhookConnection(connected, config, options);
  if (connector === 'rdb') return summarizeRdbConnection(connected, config);
  return { connector, connected };
}

export async function summarizeConnections(
  connections: ConnectionSummaryEntry[],
  options: ConnectionSummaryOptions = {},
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    connections.map(({ connector, connected, config }) => summarizeConnection(connector, connected, config, options)),
  );
}
