import type { AxCommandResult } from '@ax-studio/core';

export interface AxDiscoveryApi {
  e2eSetDiscoveryArtifactPath?: (filePath: string) => Promise<{ ok: true }>;
  e2eConfigureDiscoveryFolder?: (folderPath: string) => Promise<{ ok: true }>;
  discoveryStart: (payload: {
    goal: string;
    exampleArtifactIds: string[];
    inputArtifactIds?: string[];
    desiredRecurrence?: string;
  }) => Promise<AxCommandResult>;
  discoveryInspect: (sessionId: string) => Promise<AxCommandResult>;
  discoveryCancel: (sessionId: string) => Promise<AxCommandResult>;
  discoveryRetry: (payload: {
    sessionId: string;
    expectedRevision: number;
  }) => Promise<AxCommandResult>;
  discoveryAnswer: (payload: {
    sessionId: string;
    questionId: string;
    optionId: string;
    expectedRevision?: number;
  }) => Promise<AxCommandResult>;
  discoveryPublish: (payload: {
    sessionId: string;
    name?: string;
    expectedRevision?: number;
  }) => Promise<AxCommandResult>;
}
