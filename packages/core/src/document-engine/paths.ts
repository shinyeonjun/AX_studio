import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultArtifactRoot(): string {
  const fromEnv = process.env.AX_DOCUMENT_ARTIFACT_ROOT;
  if (fromEnv) return fromEnv;
  return join(homedir(), '.ax-studio', 'documents');
}

export function documentArtifactDir(artifactRoot: string, documentId: string): string {
  return join(artifactRoot, documentId.slice(0, 2), documentId);
}
