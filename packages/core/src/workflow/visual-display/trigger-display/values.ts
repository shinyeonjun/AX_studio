import type { WorkflowCanvasDraft } from '../../canvas/draft/schema.js';
import { describeSchedule } from '../../schedule/describe.js';

export type TriggerParamValues = Record<string, string | undefined>;

/** A stored draft field as trimmed text; a field that is not text (older or damaged data) reads as unset. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export function triggerParamValues(draft: WorkflowCanvasDraft): TriggerParamValues {
  switch (draft.triggerType) {
    case 'gmail.new_message':
      return { accountId: text(draft.gmailAccount) };
    case 'slack.new_message':
      return { channel: text(draft.slackChannel) };
    case 'local_folder.new_file':
      return {
        folderId: text(draft.localFolderId),
        folderPath: text(draft.localFolderPath),
        extensions: text(draft.localFolderExtensions),
      };
    case 'schedule':
      // Plain-language description only; cron text never reaches the canvas.
      return { schedule: describeSchedule(draft) || undefined, timezone: text(draft.timezone) };
    case 'once':
      return { runAt: text(draft.runAt) };
    default:
      return {};
  }
}
