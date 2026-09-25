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
  const unique = requests.filter((request, index, all) => all.findIndex((candidate) => candidate.id === request.id) === index);
  if (!['execution.enqueue_once', 'workflow.create', 'job.propose'].includes(result.command ?? '')) return unique;

  const labelCounts = new Map<string, number>();
  for (const request of unique) labelCounts.set(request.label, (labelCounts.get(request.label) ?? 0) + 1);
  const labelIndexes = new Map<string, number>();
  return unique.map((request) => {
    if ((labelCounts.get(request.label) ?? 0) < 2) return request;
    const index = (labelIndexes.get(request.label) ?? 0) + 1;
    labelIndexes.set(request.label, index);
    const step = request.stepId?.match(/^jev_step_(\d+)$/u)?.[1];
    const prefix = step ? `${step}단계 · ` : '';
    return { ...request, label: `${prefix}${request.label} (${index})` };
  });
}
