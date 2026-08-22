import type { ModulePackage } from '../module-package.js';
import { HttpConnector, mergeHttpAuthSecret, parseHttpConnectionConfig } from '../http/index.js';
import { HTTP_CAPABILITIES, HTTP_CATALOG } from './catalog-data.js';

export const httpModulePackage: ModulePackage = {
  id: 'http',
  catalog: HTTP_CATALOG,
  capabilities: HTTP_CAPABILITIES,
  registration: {
    instantiate: (config) => {
      const parsed = parseHttpConnectionConfig(config);
      if (!parsed) return null;
      const withSecret = mergeHttpAuthSecret(parsed, readInlineAuthSecret(config));
      return withSecret ? new HttpConnector(withSecret) : null;
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
