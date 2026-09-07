export interface StoredArtifact {
  id: string;
  sha256: string;
  fileName: string;
  storedPath: string;
  mimeType?: string;
  size: number;
  createdAt: string;
}
