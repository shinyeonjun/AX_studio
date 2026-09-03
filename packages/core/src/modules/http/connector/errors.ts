const MAX_HTTP_ERROR_BODY_PREVIEW_CHARS = 4_000;

export function httpErrorDetails(result: {
  status: number;
  statusText: string;
  body: string;
  truncated: boolean;
}) {
  const body = result.body.slice(0, MAX_HTTP_ERROR_BODY_PREVIEW_CHARS);
  return {
    status: result.status,
    statusText: result.statusText.slice(0, 120),
    body,
    truncated: result.truncated || result.body.length > body.length,
  };
}
