import type { ModulePackage } from '../module-package.js';
import { HttpConnector, mergeHttpAuthSecret, parseHttpEndpoints } from '../http/index.js';
import { HTTP_CAPABILITIES, HTTP_CATALOG } from '../http/catalog.js';

export const httpModulePackage: ModulePackage = {
  id: 'http',
  catalog: HTTP_CATALOG,
  capabilities: HTTP_CAPABILITIES,
  registration: {
    instantiate: (config) => {
      const endpoints = parseHttpEndpoints(config);
      if (endpoints.length === 0) return null;
      const inline = readInlineAuthSecret(config);
      const usable = endpoints.flatMap((endpoint) => {
        const merged = mergeHttpAuthSecret(endpoint, inline);
        return merged ? [{ ...endpoint, ...merged, id: endpoint.id }] : [];
      });
      return usable.length > 0 ? new HttpConnector(usable) : null;
    },
  },
};

function readInlineAuthSecret(config: Record<string, unknown> | undefined): { token?: string; password?: string } | null {
  if (!config) return null;
  const auth = config.auth;
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return null;
  const record = auth as Record<string, unknown>;
  return {
    token: typeof record.token === 'string' ? record.token : undefined,
    password: typeof record.password === 'string' ? record.password : undefined,
  };
}
