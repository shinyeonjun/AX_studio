import type { ModelProvider, StructuredGenerateInput } from '../../agent/model/provider.js';
import type { WorkflowIR } from '../../workflow/schema.js';

export class CloudSpyProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  sawSecret = false;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const blob = `${input.system}\n${input.user ?? ''}`;
    this.sawSecret = blob.includes('secret-pdf-body');
    return input.schema.parse({ ok: true });
  }

  async generateText(): Promise<string> {
    return '';
  }
}

export function slackNotifyWorkflow(overrides: Partial<WorkflowIR> = {}): WorkflowIR {
  return {
    name: '알림',
    goal: 'Slack 알림',
    version: 1,
    steps: [
      {
        type: 'action',
        id: 'notify',
        connector: 'slack',
        action: 'message.send',
        params: { channel: '#ops', text: 'hello' },
        sideEffect: 'EXTERNAL',
      },
    ],
    permissions: {},
    approval: [],
    allowExternalAuto: false,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
    ...overrides,
  } as unknown as WorkflowIR;
}
