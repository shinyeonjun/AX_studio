import type { AxCommandResult, AxInputRequest } from './schema.js';

/**
 * Converts host validation issues into renderer data. This is intentionally
 * separate from the transcript: the model still receives the full result,
 * while the user sees a typed control instead of protocol JSON.
 */
export function inputRequestsForResult(result: AxCommandResult): AxInputRequest[] {
  if (result.status !== 'needs_input' && result.status !== 'invalid') return [];
  const requests = [
    ...(result.inputRequests ?? []),
    ...result.issues.flatMap((issue) => issue.inputRequests ?? []),
  ];
  return requests.filter((request, index, all) => all.findIndex((candidate) => candidate.id === request.id) === index);
}
