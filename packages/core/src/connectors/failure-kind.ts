import type { ConnectorFailureKind } from './types.js';

function httpStatus(errorDetails: unknown): number | undefined {
  if (!errorDetails || typeof errorDetails !== 'object' || Array.isArray(errorDetails)) return undefined;
  const status = (errorDetails as Record<string, unknown>).status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

/** Map connector-specific errors to safe, provider-independent recovery signals. */
export function connectorFailureKind(errorCode?: string, errorDetails?: unknown): ConnectorFailureKind {
  const code = errorCode?.slice(0, 160).toLowerCase() ?? '';
  const status = httpStatus(errorDetails);
  if (/^(?:ssrf_blocked|policy_denied|capability_not_allowed_in_plain_chat|source_content_requires_local_ai)$/u.test(code)) return 'host_policy';
  if (status === 404 || /(?:^|[_:-])not[_-]?found(?:$|[_:-])/u.test(code)) return 'not_found';
  if (status === 401 || status === 403 || /(?:unauthori[sz]ed|forbidden|permission|oauth_refresh_failed)/u.test(code)) return 'permission_denied';
  if ((status !== undefined && (status === 408 || status === 425 || status === 429 || status >= 500))
    || /(?:timeout|timed_out|rate_limit|temporar|unavailable|network|connection_reset)/u.test(code)) return 'transient';
  if (status === 400 || status === 422 || /(?:invalid|bad_request|validation)/u.test(code)) return 'invalid_request';
  return errorCode ? 'provider_error' : 'unknown';
}

/** Only these provider failures permit Jev to choose a different read candidate. */
export function isRecoverableConnectorFailure(kind: ConnectorFailureKind): boolean {
  return kind === 'not_found' || kind === 'transient' || kind === 'provider_error';
}
