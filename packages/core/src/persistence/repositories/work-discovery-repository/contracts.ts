export interface DiscoveryExampleRecord {
  id: string;
  sessionId: string;
  label?: string;
  outputArtifactIds: string[];
  inputArtifactIds: string[];
  observationsJson: string;
  createdAt: string;
}

export interface DiscoverySnapshotRecord {
  id: string;
  sessionId: string;
  exampleId: string;
  sourceId: string;
  kind: string;
  artifactId?: string;
  manifestPath?: string;
  fingerprint: string;
  queryJson?: string;
  metadataJson?: string;
  capturedAt: string;
}

export interface DiscoveryReplayCaseRecord {
  id: string;
  sessionId: string;
  exampleId: string;
  snapshotSetId: string;
  expectedObservationsJson: string;
  lastResultJson?: string;
  createdAt: string;
}
