import type { WorkflowCanvasDraft } from '../../canvas/draft/schema.js';

export type TriggerParamValues = Record<string, string | undefined>;

export function triggerParamValues(draft: WorkflowCanvasDraft): TriggerParamValues {
  switch (draft.triggerType) {
    case 'gmail.new_message':
      return { accountId: draft.gmailAccount?.trim() };
    case 'slack.new_message':
      return { channel: draft.slackChannel?.trim() };
    case 'local_folder.new_file':
      return {
        folderId: draft.localFolderId?.trim(),
        folderPath: draft.localFolderPath?.trim(),
        extensions: draft.localFolderExtensions?.trim(),
      };
    case 'schedule':
      return { schedule: draft.schedule?.trim(), timezone: draft.timezone?.trim() };
    case 'once':
      return { runAt: draft.runAt?.trim() };
    default:
      return {};
  }
}
