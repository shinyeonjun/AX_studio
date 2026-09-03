import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { AxCommandService } from '../service.js';

export const commandChatContext = { executionContext: { origin: 'agent' as const } };

export const dailyBriefArgs = {
  name: 'Daily Dev Brief',
  goal: '전날 GitHub 커밋 리스크를 Slack에 요약한다',
  schedule: { cron: '0 21 * * *', timezone: 'Asia/Seoul' },
  fetch: { method: 'GET' as const, path: '/repos/shinyeonjun/AX_studio/commits' },
  interpret: { goal: '커밋이 없으면 notify=false, 있으면 짧은 리스크/테스트 요약' },
  notify: { connector: 'slack' as const, channel: '#ax테스트2', skipIfEmpty: true },
  runOnceNow: true,
  allowExternalAuto: true,
};

export async function connectedService(runWorkflow?: (workflowId: string) => Promise<unknown>) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  store.setConnection('http', true, { baseUrl: 'https://api.github.com/' });
  store.setConnection('slack', true);
  const chat = store.saveWorkspaceChat({ messages: [] });
  const service = new AxCommandService(store, { runWorkflow });
  return { store, service, chat };
}
