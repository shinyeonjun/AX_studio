import type { AxCommand } from '@ax-studio/core';
import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';

const MAX_COMMAND_CHARS = 250_000;

function validateCommandBoundary(value: unknown): AxCommand {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? '';
  } catch {
    throw new Error('AX command는 JSON으로 직렬화할 수 있어야 합니다.');
  }
  if (serialized.length > MAX_COMMAND_CHARS) {
    throw new Error(`AX command가 너무 큽니다. ${MAX_COMMAND_CHARS.toLocaleString()}자 이내여야 합니다.`);
  }
  return value as AxCommand;
}

export function registerCommandHandlers() {
  ipcHandle('ax:command', async (_event, rawCommand: unknown) => {
    const command = validateCommandBoundary(rawCommand);
    return getCore().commandService.execute(command, {
      executionContext: { interactionMode: 'plain_chat' },
    });
  });
}
