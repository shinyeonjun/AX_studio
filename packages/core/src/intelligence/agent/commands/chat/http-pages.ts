import type { AxCommand, AxCommandResult } from '../schema.js';
import { gatherHttpPages, gatheredCompleteness } from '../../../../connectors/http/connector/pagination.js';
import { httpResponseFromResult } from './result/read-tables.js';

export { MAX_HTTP_PAGES, MAX_HTTP_ROWS, nextHttpPagePath } from '../../../../connectors/http/connector/pagination.js';

function readableBody(result: AxCommandResult): string | undefined {
  if (result.status !== 'ok') return undefined;
  const response = httpResponseFromResult(result);
  return response.success && !response.data.truncated && response.data.status < 300 ? response.data.body : undefined;
}

/** The same HTTP read, asking the connector to follow every page itself (see executeHttpAction). */
export function withAllPages(command: AxCommand): AxCommand {
  if (command.name !== 'capability.invoke' || command.args.id !== 'http.request') return command;
  return { ...command, args: { ...command.args, params: { ...command.args.params as Record<string, unknown>, allPages: true } } } as AxCommand;
}

/**
 * Every page of a paged GET answer, merged into the first response so the table, its filter and
 * its totals see the whole dataset. Each further page is the same command with only its page
 * parameter moved, run through `read` (the chat's own scoped read).
 */
export async function readAllHttpPages(
  command: AxCommand,
  result: AxCommandResult,
  read: (command: AxCommand) => Promise<AxCommandResult>,
): Promise<{ result: AxCommandResult; pages: number; complete: boolean }> {
  const params = command.name === 'capability.invoke' && command.args.id === 'http.request'
    ? command.args.params as Record<string, unknown> | undefined : undefined;
  const method = String(params?.method ?? 'GET').toUpperCase();
  const firstBody = readableBody(result);
  if (!params || typeof params.path !== 'string' || method !== 'GET' || firstBody === undefined) return { result, pages: 1, complete: false };
  const gathered = await gatherHttpPages(params.path, firstBody, async (path) =>
    readableBody(await read({ ...command, args: { ...command.args, params: { ...params, path } } } as AxCommand)));
  const response = httpResponseFromResult(result);
  if (gathered.body === undefined || !response.success) return { result, pages: 1, complete: gathered.complete };
  const mergedResponse = { ...response.data, body: gathered.body, completeness: gatheredCompleteness(gathered) };
  const data = result.data as Record<string, unknown>;
  return {
    result: { ...result, data: Object.hasOwn(data, 'data') ? { ...data, data: mergedResponse } : mergedResponse },
    pages: gathered.pages,
    complete: gathered.complete,
  };
}
