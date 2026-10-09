/** Files AX Studio writes for people to keep: one entry per kind, so every surface agrees on them. */
export const GENERATED_FILE_TYPES = {
  pdf: { extension: 'pdf', mimeType: 'application/pdf', label: 'PDF', logCode: 'pdf_generated' },
  xlsx: {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel',
    logCode: 'xlsx_generated',
  },
  docx: {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word',
    logCode: 'docx_generated',
  },
} as const;

export type GeneratedFileExtension = keyof typeof GENERATED_FILE_TYPES;
export type GeneratedFileType = (typeof GENERATED_FILE_TYPES)[GeneratedFileExtension];

export function generatedFileType(extension: GeneratedFileExtension): GeneratedFileType {
  return GENERATED_FILE_TYPES[extension];
}

/** The kind of a stored file, only when its type and its name's extension agree. */
export function generatedFileTypeOf(mimeType: string, fileName: string): GeneratedFileType | undefined {
  const name = fileName.toLowerCase();
  return Object.values(GENERATED_FILE_TYPES)
    .find((type) => type.mimeType === mimeType && name.endsWith(`.${type.extension}`));
}
