import { describe, expect, it, vi } from 'vitest';
import { buildHttpResponseArtifact } from '../../contracts/artifacts/http-response.js';
import type { ConnectorContext } from '../../connectors/types.js';
import { ReportGenerationService } from './service.js';

describe('configured report route evidence', () => {
  it.each(['matching', 'other-origin', 'other-prefix', 'write', 'disconnected', 'malformed'])('%s OpenAPI metadata', async mode => {
    let catalog: unknown;
    let inspection: unknown;
    const execute = vi.fn(async () => ({ ok: true, data: buildHttpResponseArtifact({ executionId: 'probe',
      url: 'https://api.test/v3/measurements', status: 200, statusText: 'OK', headers: {}, body: '[]', truncated: false }) }));
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
      documentEngine: { pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
        pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }), pdfFormFill: vi.fn() },
      planner: { inferSourceRequirements: async () => [], inferReportPlan: vi.fn(),
        inferCapturePlan: async ({ httpConnections, inspectSource }) => {
          catalog = httpConnections;
          inspection = await inspectSource!({ kind: 'http_connection', connectionId: 'measurements', path: '/measurements' });
          throw new Error('stop_after_inspection');
        } },
      getConnector: name => name === 'http' ? { name: 'http', execute } : undefined,
    });
    const result = await service.generate({ goal: 'Create a monthly measurements report', templateSourceId: 't', exampleSourceId: 'e' }, {
      workspaceSessionId: 'session', artifactSink: { putBytes: vi.fn() }, log: vi.fn(),
      connections: [
        { connector: 'http', connected: true, config: { endpoints: [{ id: 'measurements', baseUrl: 'https://api.test/v3/' }] } },
        { connector: 'openapi', connected: mode !== 'disconnected', config: {
          specId: 'measurements-spec', baseUrl: mode === 'other-origin' ? 'https://other.test/v3' : mode === 'other-prefix' ? 'https://api.test/private' : 'https://api.test/v3',
          specJson: mode === 'malformed' ? {} : { openapi: '3.0.0', info: { title: 'Measurement API', version: '1' },
            servers: [{ url: 'https://api.test/v3' }], paths: { '/measurements': {
              [mode === 'write' ? 'post' : 'get']: { operationId: 'readMeasurements', summary: 'Measured readings',
                parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' }, description: 'Zero-based page index' }],
                responses: { '200': { description: 'Readings', content: { 'application/json': { schema: {
                  type: 'object', properties: { records: { type: 'array' }, metadata: { type: 'object',
                    properties: { totalPages: { type: 'integer' } } } },
                } } } } },
              },
            } } },
        } },
      ],
    } as unknown as ConnectorContext);
    expect(result.errorCode).toBe('stop_after_inspection');
    if (mode === 'matching') {
      expect(catalog).toEqual([expect.objectContaining({ id: 'measurements', operations: [expect.objectContaining({
        path: '/measurements', summary: 'Measured readings',
        parameters: [expect.objectContaining({ name: 'page', type: 'integer', description: 'Zero-based page index' })],
        responses: [expect.objectContaining({ fields: expect.arrayContaining([
          expect.objectContaining({ name: 'records', type: 'array' }),
          expect.objectContaining({ name: 'metadata.totalPages', type: 'integer' }),
        ]) })],
      })] })]);
      expect(execute).toHaveBeenCalledWith('request', { connectionId: 'measurements', method: 'GET', path: '/measurements' }, expect.anything());
      expect(inspection).toEqual([expect.objectContaining({ status: 200 })]);
    } else {
      expect(execute).not.toHaveBeenCalled();
      expect(inspection).toMatchObject({ available: false });
    }
  });
});
