import {
  DEFAULT_HTTP_ENDPOINT_ID,
  type HttpConnectionConfig,
  type HttpEndpoint,
} from '../connection/contracts.js';

export function normalizeHttpEndpoints(
  config: HttpConnectionConfig | readonly HttpEndpoint[],
): HttpEndpoint[] {
  const list: readonly HttpConnectionConfig[] = Array.isArray(config) ? config : [config];
  return list.map((entry, index) => ({
    ...entry,
    id: entry.id?.trim() || (index === 0 ? DEFAULT_HTTP_ENDPOINT_ID : `http-${index + 1}`),
  }));
}
