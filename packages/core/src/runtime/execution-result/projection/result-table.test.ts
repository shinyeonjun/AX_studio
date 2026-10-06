import { describe, expect, it } from 'vitest';
import { executeTransformAction } from '../../../connectors/transform/connector/execute.js';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import type { ExecutionLogEntry } from '../../../connectors/types.js';
import { publishExecutionResultToWorkspaceChat } from '../../execution-result-message.js';
import { executionIr, result } from '../fixtures.js';

/** The log a shaping step writes for a table of `rowCount` rows. */
async function shapingLog(rowCount: number): Promise<ExecutionLogEntry[]> {
  const log: ExecutionLogEntry[] = [];
  const source = buildTableArtifact({
    id: 'src', headers: ['title', 'stock'], rowLimit: 10_000,
    matrix: Array.from({ length: rowCount }, (_, index) => [`상품 ${index}`, index % 20]),
  });
  const shaped = await executeTransformAction('evaluate', {
    expr: { op: 'filter', input: { op: 'source', sourceId: 'src' }, where: { op: 'lt', left: { ref: 'stock' }, right: { lit: 10 } } },
    discoverySourceId: 'src', outputPath: 'result', table: source,
  }, { executionId: 'x', variables: {}, log: (entry: ExecutionLogEntry) => log.push(entry) });
  expect(shaped.ok).toBe(true);
  return log;
}

async function publish(status: 'success' | 'failed', log: ExecutionLogEntry[]) {
  const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
  const chat = store.saveWorkspaceChat({ messages: [{ role: 'user', content: '재고 표' }] });
  const executionId = store.createExecution({ ephemeral: true, workspaceSessionId: chat.id, triggerType: 'schedule', irJson: executionIr('재고 표') });
  store.finishExecution(executionId, status, undefined, log);
  publishExecutionResultToWorkspaceChat(store, result(executionId, status, log));
  return store.getWorkspaceChat(chat.id)!.messages.at(-1)!;
}

describe('a run that makes a table shows it', () => {
  it('attaches the table the run made to its result message', async () => {
    const message = await publish('success', await shapingLog(12));
    expect(message.kind).toBe('execution_result');
    expect(message.readResult?.rows.map((row) => row.values.stock)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps only the visible part of a large table and says it was cut', async () => {
    const message = await publish('success', await shapingLog(5_000));
    expect(message.readResult?.rows).toHaveLength(100);
    expect(message.readResult?.truncated).toBe(true);
  });

  it('shows no table for a failed run', async () => {
    const message = await publish('failed', await shapingLog(12));
    expect(message.readResult).toBeUndefined();
  });
});
