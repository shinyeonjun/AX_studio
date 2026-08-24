import { basename, extname } from 'node:path';
import { fileRefFromLocalScan } from '../contracts/artifacts/file-ref.js';
import { toDocumentArtifact } from '../contracts/artifacts/document-normalize.js';
import { getDocumentEngineClient } from '../document-engine/engine-client.js';
import type { ArtifactStore, StoredArtifact } from './artifact-store.js';

export async function importDiscoveryArtifact(
  store: ArtifactStore,
  sourcePath: string,
): Promise<StoredArtifact> {
  const stored = store.importFile(sourcePath);
  const ext = extname(sourcePath).toLowerCase();
  if (ext !== '.pdf') return stored;

  if (store.getDocumentArtifact(stored.id)) return stored;

  const ingested = await getDocumentEngineClient().ingest(stored.storedPath, {
    engine: 'auto',
    ocr: 'auto',
  });
  store.putIngestResult(stored.id, ingested);
  const artifact = toDocumentArtifact(
    ingested,
    fileRefFromLocalScan({
      filePath: stored.storedPath,
      fileName: basename(sourcePath),
      extension: ext,
      size: stored.size,
    }),
  );
  store.putDocumentArtifact(stored.id, { ...artifact, id: stored.id });
  return stored;
}
