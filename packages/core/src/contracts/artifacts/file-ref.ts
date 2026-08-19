import { z } from 'zod';

export const FileRefSchema = z.object({
  sourceId: z.string().optional(),
  folderId: z.string().optional(),
  folderPath: z.string().optional(),
  path: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  extension: z.string().optional(),
  size: z.number().nonnegative().optional(),
  modifiedAt: z.string().optional(),
});

export type FileRef = z.infer<typeof FileRefSchema>;

export const FileCreatedEventSchema = z.object({
  file: FileRefSchema,
});

export type FileCreatedEvent = z.infer<typeof FileCreatedEventSchema>;

/** Map local-folder scan/trigger payload into a FileRef contract. */
export function fileRefFromLocalScan(input: {
  key?: string;
  filePath: string;
  fileName: string;
  extension?: string;
  size?: number;
  modifiedAt?: string;
  folderId?: string;
  folderPath?: string;
}): FileRef {
  return FileRefSchema.parse({
    sourceId: input.folderId ?? 'local_folder',
    folderId: input.folderId,
    folderPath: input.folderPath,
    path: input.filePath,
    name: input.fileName,
    extension: input.extension,
    mimeType: input.extension ? mimeFromExtension(input.extension) : undefined,
    size: input.size,
    modifiedAt: input.modifiedAt,
  });
}

function mimeFromExtension(ext: string): string {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  switch (normalized) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.txt':
      return 'text/plain';
    case '.md':
      return 'text/markdown';
    case '.html':
      return 'text/html';
    default:
      return 'application/octet-stream';
  }
}
