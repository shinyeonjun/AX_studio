import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalSheetConnector } from '../../../connectors/local-sheet/connector.js';
import type { DecisionEngine } from '../../../contracts/decision.js';
import { AgentHarness } from '../../agent/harness.js';
import { runAxCommandChat } from '../../agent/commands/chat.js';
import { AxCommandService } from '../../agent/commands/service.js';
import { scriptedModel } from '../../agent/commands/chat/fixtures.js';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { buildJevReadOperationIndex } from '../../decision/read-operation-catalog.js';
import { buildDesignToolContext } from '../context.js';

describe('local sheet capability context', () => {
  it('routes through Jev and reads a named CSV inside its connected folder', async () => {
    const folderPath = mkdtempSync(join(tmpdir(), 'ax-local-sheet-chat-'));
    const db = await createDatabaseAsync(':memory:');
    try {
      writeFileSync(join(folderPath, 'sales.csv'), 'product,stock\nWidget,4\n');
      const connections = [
        {
          connector: 'local_folder',
          connected: true,
          config: {
            folders: [{ id: 'sales', label: 'Sales', path: folderPath, addedAt: '' }],
          },
        },
      ];
      const index = buildJevReadOperationIndex(connections);
      const userMessage = 'sales.csv 내용을 표로 보여줘';
      const selection = index.select(userMessage);
      let jevEvaluations = 0;
      const decisionEngine: DecisionEngine = {
        evaluate: async (request) => {
          jevEvaluations += 1;
          const operationQuestion = request.questions.operation;
          if (operationQuestion?.type !== 'choice') throw new Error('Expected Jev read-operation choices');
          const operation = Object.entries(operationQuestion.criteria).find(([key, criterion]) =>
            key.startsWith('op_') && JSON.stringify(criterion).includes('local_sheet'),
          )?.[0];
          if (!operation) throw new Error('Expected a local sheet candidate');
          return { answers: {
            route: {
              type: 'choice', choice: 'capability_read',
              probabilities: { capability_read: 0.99 }, confidence: 0.99,
            },
            operation: { type: 'choice', choice: operation, probabilities: { [operation]: 0.99 }, confidence: 0.99 },
            table_transform: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
          } };
        },
      };
      const service = new AxCommandService(new WorkflowStore(db));
      const context = buildDesignToolContext(connections, ['local_folder', 'local_sheet'], {
        allowUntrustedData: true,
        connectors: { local_sheet: new LocalSheetConnector() },
      });
      const textSeen = [];
      const reply = await runAxCommandChat({
        harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen)),
        commandService: service,
        decisionEngine,
        connectedConnectors: ['local_folder', 'local_sheet'],
        resolveReadOperationSelection: () => selection,
        messages: [],
        userMessage,
        designToolContext: context,
      });

      expect(reply).toContain('| product | stock |');
      expect(reply).toContain('| Widget | 4 |');
      expect(jevEvaluations).toBe(1);
      expect(textSeen).toHaveLength(0);
    } finally {
      db.close();
      rmSync(folderPath, { recursive: true, force: true });
    }
  });
});
