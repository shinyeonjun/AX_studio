import type { AgentHarness } from '../agents-harness/harness.js';
import type { SkillStore } from '../store/skill-store.js';
import type { SkillIR } from '../skill/schema.js';
import { KO } from '../i18n/ko.js';
import { SkillRevisionSchema } from './revision-schema.js';

export function explainExecution(store: SkillStore, question: string): string {
  const executions = store.listExecutions(20);
  const latest = executions[0];
  if (!latest) return KO.execution.noRecentRuns;

  const q = question.toLowerCase();
  if (q.includes('왜') || q.includes('안') || q.includes('실패')) {
    if (latest.status === 'failed' || latest.errorCode) {
      const code = latest.errorCode ?? 'unknown';
      const log = JSON.parse(latest.logJson ?? '[]') as Array<{ level?: string; message?: string; code?: string }>;
      const detail = log.find((l) => l.level === 'error')?.message;
      return [
        KO.execution.failedAt(latest.startedAt),
        KO.execution.cause(KO.execution.errorMessages[code] ?? code),
        detail ? KO.execution.detail(detail) : '',
        KO.execution.recommendedAction,
      ].filter(Boolean).join('\n');
    }
    return KO.execution.statusAt(latest.startedAt, latest.status);
  }

  return KO.execution.recent(latest.startedAt, latest.status, latest.errorCode);
}

export interface SkillRevisionOptions {
  harness?: AgentHarness;
}

export async function proposeSkillRevision(
  current: Partial<SkillIR>,
  instruction: string,
  options: SkillRevisionOptions = {},
): Promise<{ proposal: string; changes: string[] }> {
  if (options.harness) {
    const { output } = await options.harness.run({
      role: 'revise',
      outputSchema: SkillRevisionSchema,
      user: instruction,
      context: {
        skillJson: JSON.stringify(current, null, 2),
        instruction,
      },
    });
    return SkillRevisionSchema.parse(output);
  }

  return {
    proposal: KO.revision.fallbackProposal(current.goal, instruction),
    changes: [],
  };
}
