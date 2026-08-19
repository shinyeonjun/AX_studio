import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

export class MockLocalFolderConnector implements Connector {
  name = 'local_folder';
  config = {
    folders: [
      {
        id: 'folder-inbox',
        label: 'Inbox',
        path: '/mock/inbox',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
  files: Record<string, string[]> = {
    'folder-inbox': [],
  };

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action === 'new_file.poll') {
      const folderId = String(params.folderId ?? '');
      const folder = this.config.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'folder_not_found' };

      const keys = this.files[folderId] ?? [];
      const extensions = (params.extensions as string[] | undefined)?.map((ext) =>
        ext.trim().toLowerCase().startsWith('.') ? ext.trim().toLowerCase() : `.${ext.trim().toLowerCase()}`,
      );
      const allowed = extensions?.length ? new Set(extensions) : null;

      const files = keys
        .filter((key) => {
          if (!allowed) return true;
          const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
          return allowed.has(ext);
        })
        .map((key) => ({
          key,
          filePath: key,
          fileName: key.split(/[/\\]/).pop() ?? key,
          extension: key.includes('.') ? key.slice(key.lastIndexOf('.')).toLowerCase() : '',
          size: 0,
          modifiedAt: new Date().toISOString(),
        }));

      const seen = new Set((params.seenFileKeys as string[]) ?? []);
      const initialized = Boolean(params.initialized);

      if (!initialized) {
        return {
          ok: true,
          data: {
            events: [],
            cursor: { initialized: true, folderId, seenFileKeys: files.map((file) => file.key) },
          },
        };
      }

      const newFiles = files.filter((file) => !seen.has(file.key));
      const seenFileKeys = [...seen, ...newFiles.map((file) => file.key)];

      return {
        ok: true,
        data: {
          events: newFiles.map((file) => ({
            type: 'local_folder.new_file',
            payload: {
              folderId: folder.id,
              folderLabel: folder.label,
              folderPath: folder.path,
              filePath: file.filePath,
              fileName: file.fileName,
              extension: file.extension,
              size: file.size,
              modifiedAt: file.modifiedAt,
            },
          })),
          cursor: { initialized: true, folderId, seenFileKeys },
        },
      };
    }

    if (action === 'list') {
      const folderId = String(params.folderId ?? '');
      const folder = this.config.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'folder_not_found' };
      const keys = this.files[folderId] ?? [];
      return {
        ok: true,
        data: {
          folder,
          files: keys.map((key) => ({ key, filePath: key, fileName: key.split(/[/\\]/).pop() ?? key })),
        },
      };
    }

    return { ok: false, error: `Unknown local_folder action: ${action}` };
  }
}
