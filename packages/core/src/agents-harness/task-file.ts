import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const HARNESS_TASK_PROMPT =
  'Read AX_TASK.md in this workspace and follow it exactly. Return structured output only.';

/** Harness 전용 workspace task 파일. CLI provider가 긴 prompt를 argv 대신 파일로 전달할 때 사용합니다. */
export async function writeHarnessTaskFile(dir: string, prompt: string): Promise<string> {
  const path = join(dir, 'AX_TASK.md');
  await writeFile(path, prompt, 'utf8');
  return path;
}
