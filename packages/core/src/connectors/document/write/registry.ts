import type { DocumentWriteFormatModule } from './types.js';

const writeModuleLoaders = new Map<string, () => Promise<DocumentWriteFormatModule>>([
  ['html', async () => (await import('./html/index.js')).htmlWriteModule],
  ['docx', async () => (await import('./docx/index.js')).docxWriteModule],
  ['pdf', async () => (await import('./pdf/index.js')).pdfWriteModule],
]);

const writeActions = [
  'html.render',
  'docx.fill',
  'pdf.generate',
  'pdf.form.analyze',
  'pdf.form.fill',
  'pdf.toHtml',
];

export async function getDocumentWriteHandler(action: string): Promise<import('../types.js').DocumentActionHandler | undefined> {
  const separator = action.indexOf('.');
  if (separator < 1) return undefined;
  const module = await writeModuleLoaders.get(action.slice(0, separator))?.();
  return module?.actions[action.slice(separator + 1)];
}

export function listDocumentWriteActions(): string[] {
  return [...writeActions];
}
