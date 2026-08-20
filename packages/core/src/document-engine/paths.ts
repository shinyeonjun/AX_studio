import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultArtifactRoot(): string {
  const fromEnv = process.env.AX_DOCUMENT_ARTIFACT_ROOT;
  if (fromEnv) return fromEnv;
  return join(homedir(), '.ax-studio', 'documents');
}
