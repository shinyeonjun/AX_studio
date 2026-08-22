import { registerDynamicCapabilities } from '../catalog/dynamic-catalog.js';
import { OpenApiConnector } from './connector.js';
import { openApiCapabilitiesFromSpec, parseOpenApiSpec, type OpenApiSpec } from './parse.js';

export interface OpenApiIngestResult {
  spec: OpenApiSpec;
  connector: OpenApiConnector;
  capabilityIds: string[];
}

export function ingestOpenApiSpec(id: string, raw: unknown): OpenApiIngestResult {
  const spec = parseOpenApiSpec(id, raw);
  const capabilities = openApiCapabilitiesFromSpec(spec);
  registerDynamicCapabilities(capabilities);
  return {
    spec,
    connector: new OpenApiConnector([spec]),
    capabilityIds: capabilities.map((cap) => cap.id),
  };
}
