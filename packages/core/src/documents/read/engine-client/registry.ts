import type { DocumentEngineClient } from './contracts.js';
import { StdioDocumentEngineClient } from './stdio.js';

let configuredClient: DocumentEngineClient | null = null;

export function setDocumentEngineClient(client: DocumentEngineClient | null): void {
  configuredClient = client;
}

export function getDocumentEngineClient(): DocumentEngineClient {
  if (!configuredClient) {
    configuredClient = new StdioDocumentEngineClient();
  }
  return configuredClient;
}
