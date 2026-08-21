import type { TriggerHandler, TriggerPollResult } from '../../types.js';

export const localFolderNewFileHandler: TriggerHandler<{
  type: 'local_folder.new_file';
  folderId: string;
  folderPath?: string;
  extensions?: string[];
}> = {
  type: 'local_folder.new_file',
  connector: 'local_folder',
  transport: 'poll',

  async poll(ctx) {
    const localFolder = ctx.connectors.local_folder;
    if (!localFolder) {
      throw new Error('local_folder_connector_missing');
    }

    const folderChanged = Boolean(ctx.cursor.folderId && ctx.cursor.folderId !== ctx.trigger.folderId);

    const result = await localFolder.execute(
      'new_file.poll',
      {
        folderId: ctx.trigger.folderId,
        folderPath: ctx.trigger.folderPath,
        extensions: ctx.trigger.extensions,
        initialized: (ctx.cursor.initialized ?? false) && !folderChanged,
        seenFileKeys: folderChanged ? [] : (ctx.cursor.seenFileKeys ?? []),
      },
      {
        executionId: `trigger-poll:${ctx.workflowId}`,
        workflowId: ctx.workflowId,
        variables: {},
        log: () => {},
      },
    );

    if (!result.ok) {
      throw new Error(result.error ?? 'local_folder trigger poll failed');
    }

    const data = result.data as {
      events?: Array<{ type: string; payload: Record<string, unknown> }>;
      cursor: TriggerPollResult['cursor'];
    };

    return {
      events: (data.events ?? []).map((event) => ({
        type: event.type,
        payload: event.payload,
      })),
      cursor: data.cursor ?? ctx.cursor,
    };
  },
};
