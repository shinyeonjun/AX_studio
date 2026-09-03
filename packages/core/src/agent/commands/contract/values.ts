import {
  AX_COMMAND_NAMES,
  type AxCommand,
  type AxCommandIssue,
  type AxCommandName,
  type AxCommandResult,
  type AxInputRequest,
} from '../schema.js';

export const COMMAND_NAME_SET = new Set<string>(AX_COMMAND_NAMES);

export function textArg(command: AxCommand, name: string): string | undefined {
  const value = command.args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function issue(
  code: string,
  message: string,
  path?: string,
  details?: unknown,
  inputRequests?: AxInputRequest[],
): AxCommandIssue {
  return {
    code,
    message,
    ...(path ? { path } : {}),
    ...(details === undefined ? {} : { details }),
    ...(inputRequests?.length ? { inputRequests } : {}),
  };
}

export function result(
  command: AxCommandName,
  status: AxCommandResult['status'],
  data?: unknown,
  issues: AxCommandIssue[] = [],
): AxCommandResult {
  return { command, status, ...(data === undefined ? {} : { data }), issues, inputRequests: [] };
}

export function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}
