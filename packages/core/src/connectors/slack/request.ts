export async function slackRequest<T extends { ok?: boolean; error?: string }>(
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const response = await request();
  signal?.throwIfAborted();
  if (response.ok === false) throw new Error(response.error || 'slack_error');
  return response;
}
