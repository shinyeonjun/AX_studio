import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import type { LocalFolderConnectionConfig } from './connection.js';
import { newFilePoll } from './new-file-poll.js';
import { scanFolder } from './scan.js';

export class LocalFolderConnector implements Connector {
  name = 'local_folder';

  constructor(private readonly config: LocalFolderConnectionConfig) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action === 'new_file.poll') {
      return newFilePoll(
        this.config,
        {
          folderId: String(params.folderId ?? ''),
          initialized: Boolean(params.initialized),
          seenFileKeys: (params.seenFileKeys as string[]) ?? [],
          extensions: (params.extensions as string[]) ?? undefined,
        },
        ctx,
      );
    }

    if (action === 'list') {
      const folderId = String(params.folderId ?? '');
      const folder = this.config.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'folder_not_found' };
      const files = scanFolder(folder.path, (params.extensions as string[]) ?? undefined);
      return { ok: true, data: { folder, files } };
    }

    return { ok: false, error: `Unknown local_folder action: ${action}` };
  }
}
