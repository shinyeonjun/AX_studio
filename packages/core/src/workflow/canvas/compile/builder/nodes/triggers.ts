import type { WorkflowIR, Step } from '../../../../../workflow/schema.js';
import type { WorkflowCanvasDraft } from '../../../draft/schema.js';
import { GMAIL_READ_WORKFLOW_NODE_ID } from '../../constants.js';

function hasGmailReadStep(steps: Step[]): boolean {
  return steps.some(
    (step) =>
      step.type === 'action' &&
      step.connector === 'gmail' &&
      (step.action === 'messages.read' || step.action === 'message.read'),
  );
}

function hasDocumentIngestStep(steps: Step[]): boolean {
  return steps.some(
    (step) => step.type === 'action' && step.connector === 'document' && step.action === 'ingest',
  );
}

export function workflowInputs(triggerType: WorkflowCanvasDraft['triggerType'], steps: Step[]): string[] {
  if (triggerType === 'gmail.new_message') return [...GMAIL_TRIGGER_INPUTS];
  if (triggerType === 'slack.new_message') return [...SLACK_TRIGGER_INPUTS];
  if (triggerType === 'local_folder.new_file') return [...LOCAL_FOLDER_TRIGGER_INPUTS];
  // A one-time document workflow receives the selected/latest connected file
  // as manual-run input. This is a data contract, not another trigger.
  if (triggerType === 'manual' && hasDocumentIngestStep(steps)) {
    return [...LOCAL_FOLDER_TRIGGER_INPUTS];
  }
  return [];
}

export function injectGmailReadIfNeeded(steps: Step[], draft: WorkflowCanvasDraft): Step[] {
  if (draft.triggerType !== 'gmail.new_message' || hasGmailReadStep(steps)) return steps;
  return [
    {
      type: 'action',
      id: GMAIL_READ_WORKFLOW_NODE_ID,
      connector: 'gmail',
      action: 'messages.read',
      params: { messageId: '{{messageId}}' },
      sideEffect: 'NONE',
    },
    ...steps,
  ];
}

export function buildTrigger(draft: WorkflowCanvasDraft): WorkflowIR['trigger'] | undefined {
  if (!draft.triggerType) return undefined;

  if (draft.triggerType === 'schedule') {
    return {
      type: 'schedule',
      schedule: draft.schedule?.trim() ?? '',
      timezone: draft.timezone?.trim() ?? '',
      filter: draft.triggerFilter,
    };
  }
  if (draft.triggerType === 'once') {
    return { type: 'once', runAt: draft.runAt?.trim() ?? '', filter: draft.triggerFilter };
  }
  if (draft.triggerType === 'gmail.new_message') {
    return {
      type: 'gmail.new_message',
      accountId: draft.gmailAccount?.trim() ?? '',
      filter: draft.triggerFilter,
    };
  }
  if (draft.triggerType === 'slack.new_message') {
    return {
      type: 'slack.new_message',
      channel: draft.slackChannel?.trim() ?? '',
      filter: draft.triggerFilter,
    };
  }
  if (draft.triggerType === 'local_folder.new_file') {
    const extensions = draft.localFolderExtensions
      ?.split(',')
      .map((ext) => ext.trim())
      .filter(Boolean);
    return {
      type: 'local_folder.new_file',
      folderId: draft.localFolderId?.trim() ?? '',
      folderPath: draft.localFolderPath?.trim() || undefined,
      extensions: extensions?.length ? extensions : undefined,
      filter: draft.triggerFilter,
    };
  }
  if (draft.triggerType === 'manual') {
    return { type: 'manual', filter: draft.triggerFilter };
  }
  return undefined;
}

const LOCAL_FOLDER_TRIGGER_INPUTS = [
  'folderId',
  'folderPath',
  'filePath',
  'fileName',
  'extension',
  'size',
  'modifiedAt',
] as const;

const GMAIL_TRIGGER_INPUTS = ['messageId', 'from', 'subject', 'snippet', 'sender'] as const;
const SLACK_TRIGGER_INPUTS = ['messageId', 'channel', 'text', 'user', 'sender', 'ts'] as const;
