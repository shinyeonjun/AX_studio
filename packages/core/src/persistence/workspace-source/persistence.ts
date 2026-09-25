import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { DocumentArtifact } from '../../contracts/artifacts/document.js';
import type { ArtifactStore } from '../artifact-store.js';
import type { WorkflowStore } from '../workflow-store.js';
import type { WorkspaceSourceRecord } from './contracts.js';
import { manifestSource, publicDocument } from './document.js';
import { ReportCheckpointStore } from '../../documents/reporting/checkpoints.js';
import { assertSessionId } from './validation.js';

export function removeSessionArtifacts(
  store: WorkflowStore,
  artifactStore: ArtifactStore,
  sessionsRoot: string,
  sessionId: string,
  sources?: readonly WorkspaceSourceRecord[],
): void {
  sessionId = assertSessionId(sessionId);
  const sessionSources = sources ?? store.listWorkspaceSources(sessionId);
  // GC artifacts this session imported, unless another session still
  // references the same content (importFile dedupes by sha).
  const artifactIds = new Set<string>();
  for (const source of sessionSources) {
    artifactIds.add(source.artifactId);
    if (source.documentArtifactId) artifactIds.add(source.documentArtifactId);
  }
  const referencedArtifactIds = artifactIds.size
    ? store.findReferencedWorkspaceSourceArtifacts([...artifactIds], sessionId)
    : new Set<string>();
  for (const artifactId of artifactIds) {
    if (referencedArtifactIds.has(artifactId)) continue;
    try {
      artifactStore.remove(artifactId);
    } catch {
      // Losing a GC pass must not block session deletion.
    }
  }
  rmSync(join(sessionsRoot, sessionId), { recursive: true, force: true });
  new ReportCheckpointStore(join(sessionsRoot, 'report-checkpoints')).removeSession(sessionId);
}

export function writeSourceManifest(
  sessionsRoot: string,
  artifactStore: ArtifactStore,
  source: WorkspaceSourceRecord,
): void {
  const sourceDir = join(sessionsRoot, source.sessionId, 'sources', source.id);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'manifest.json'), JSON.stringify({ source: manifestSource(source) }, null, 2));
  if (source.status !== 'ready' || !source.documentArtifactId) return;
  const document = artifactStore.getDocumentArtifact<DocumentArtifact>(source.documentArtifactId);
  if (!document) return;
  writeFileSync(join(sourceDir, 'docling.json'), JSON.stringify({
    sourceId: source.id,
    artifactId: source.artifactId,
    document: publicDocument(document),
  }, null, 2));
}
