import { getAxDataPaths } from '../paths/ax-data.js';

export function defaultArtifactRoot(): string {
  const fromEnv = process.env.AX_DOCUMENT_ARTIFACT_ROOT;
  if (fromEnv) return fromEnv;
  return getAxDataPaths().documents;
}

export function defaultTemplateRoot(): string {
  const fromEnv = process.env.AX_TEMPLATE_ROOT;
  if (fromEnv) return fromEnv;
  return getAxDataPaths().templates;
}
