import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runCommand } from '../../../agent/model/cli-process.js';
import type {
  DocumentEngineRequest,
  DocumentEngineResponse,
} from '../../types.js';

export interface DocumentEngineTransportOptions {
  pythonPath: string;
  workerScript: string;
  artifactRoot: string;
  timeoutMs: number;
  workerCwd: string;
}

export async function requestDocumentEngine<T>(
  options: DocumentEngineTransportOptions,
  command: string,
  params: Record<string, unknown>,
): Promise<DocumentEngineResponse<T>> {
  const payload: DocumentEngineRequest = {
    id: randomUUID(),
    command,
    params,
  };

  if (!existsSync(options.workerScript)) {
    throw new Error(
      'document_engine_worker_missing:' + options.workerScript + '. packages/document-engine 경로를 확인하세요.',
    );
  }

  const result = await runCommand(options.pythonPath, [options.workerScript], {
    timeoutMs: options.timeoutMs,
    cwd: options.workerCwd,
    input: JSON.stringify(payload),
    env: { ...process.env, PYTHONUTF8: '1' },
  });

  const stdout = result.stdout.trim();
  if (!stdout) {
    const detail = result.stderr.trim() || 'python=' + options.pythonPath + ' worker=' + options.workerScript;
    throw new Error('document_engine_empty_response:' + detail);
  }

  let parsed: DocumentEngineResponse<T>;
  try {
    parsed = JSON.parse(stdout) as DocumentEngineResponse<T>;
  } catch {
    throw new Error('document_engine_invalid_json:' + stdout.slice(0, 200));
  }

  if (result.exitCode !== 0 && parsed.ok) {
    throw new Error('document_engine_exit_' + result.exitCode);
  }

  return parsed;
}
