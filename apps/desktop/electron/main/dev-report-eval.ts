import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { AGENT_COMMAND_CONTEXT, ArtifactStore, getAxDataPaths } from '@ax-studio/core';
import type { AxCore } from './core-instance.js';

/**
 * Development only: run report generation for a list of last-period reports with the real AI and
 * the connected data, the way a chat request queues it, and keep each result for comparison.
 * Started by `AX_REPORT_EVAL=<cases.json>`; routing a chat message is outside this check.
 */
interface EvalCase {
  id: string;
  example: string;
  goal: string;
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const TERMINAL = new Set(['success', 'failed', 'cancelled']);
const CASE_TIMEOUT_MS = 30 * 60_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCase(core: AxCore, item: EvalCase, outDir: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  const chat = core.store.saveWorkspaceChat({ messages: [] });
  const { source } = await core.workspaceSources.attachToSession(chat.id, item.example, MIME[extname(item.example).toLowerCase()]);
  while (core.workspaceSources.list(chat.id).find((entry) => entry.id === source.id)?.status === 'processing') await wait(1_000);
  const queued = await core.commandService.execute(
    { name: 'report.generate', args: { goal: item.goal, exampleSourceId: source.id } },
    { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id },
  );
  if (queued.status !== 'queued') return { id: item.id, status: 'not_queued', result: queued };
  let execution: ReturnType<AxCore['store']['listExecutions']>[number] | undefined;
  while (Date.now() - started < CASE_TIMEOUT_MS) {
    execution = core.store.listExecutions(50).find((entry) => entry.workspaceSessionId === chat.id);
    if (execution && TERMINAL.has(execution.status)) break;
    await wait(5_000);
  }
  const log = execution?.logJson ? JSON.parse(execution.logJson) as Array<{ code?: string; message?: string; data?: Record<string, unknown> }> : [];
  const generated = log.find((entry) => entry.code === 'pdf_generated' || entry.code === 'docx_generated');
  let output: string | undefined;
  const artifactId = generated?.data?.artifactId;
  if (typeof artifactId === 'string') {
    const stored = new ArtifactStore(getAxDataPaths().generated.reports).get(artifactId);
    if (stored && existsSync(stored.storedPath)) {
      output = join(outDir, `${item.id}${extname(stored.fileName)}`);
      copyFileSync(stored.storedPath, output);
    }
  }
  return {
    id: item.id,
    example: basename(item.example),
    status: execution?.status ?? 'timeout',
    durationMs: Date.now() - started,
    output,
    executionId: execution?.id,
    // Codes and messages only: the values are compared from the output file itself.
    log: log.map((entry) => ({ code: entry.code, message: entry.message,
      ...(entry.data && /failed|replay|invalid|unsupported|no_progress/.test(entry.code ?? '') ? { data: entry.data } : {}) })),
  };
}

/** `AX_REPORT_EVAL` names one cases.json, or several separated by `;`, run one after another. */
export function startDevReportEval(core: AxCore, isPackaged: boolean, env: NodeJS.ProcessEnv): void {
  const lists = (env.AX_REPORT_EVAL ?? '').split(';').map((path) => path.trim()).filter(Boolean);
  if (isPackaged || lists.length === 0) return;
  void (async () => {
    for (const casesPath of lists) {
      const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as EvalCase[];
      const outDir = join(casesPath, '..', 'results');
      mkdirSync(outDir, { recursive: true });
      const results: Array<Record<string, unknown>> = [];
      for (const item of cases) {
        try {
          results.push(await runCase(core, item, outDir));
        } catch (error) {
          results.push({ id: item.id, status: 'harness_error', error: error instanceof Error ? error.message : String(error) });
        }
        writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
      }
      writeFileSync(join(outDir, 'done'), new Date().toISOString());
    }
  })();
}
