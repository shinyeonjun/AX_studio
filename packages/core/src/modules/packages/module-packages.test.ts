import { describe, expect, it, beforeAll } from 'vitest';
import { CONNECTOR_IDS } from '../../catalog/connector-types.js';
import { CAPABILITY_CATALOG, ALL_MODULE_PACKAGES } from '../packages/catalog.js';
import { listRegisteredModules } from '../module-registry.js';
import { getTriggerHandler } from '../../triggers/registry.js';
import { listModuleSourceHandlers, registerAllModules } from '../packages/register.js';

describe('module packages', () => {
  beforeAll(() => {
    registerAllModules();
  });

  it('registers every package id', () => {
    const registered = new Set(listRegisteredModules().map((entry) => entry.id));
    for (const id of CONNECTOR_IDS) {
      expect(registered.has(id)).toBe(true);
    }
  });

  it('keeps capability ids owned by their module package', () => {
    for (const pkg of ALL_MODULE_PACKAGES) {
      for (const cap of pkg.capabilities) {
        expect(cap.connector).toBe(pkg.id);
        expect(CAPABILITY_CATALOG.some((entry) => entry.id === cap.id)).toBe(true);
      }
    }
  });

  it('registers trigger handlers declared by modules', () => {
    for (const pkg of ALL_MODULE_PACKAGES) {
      for (const handler of pkg.triggerHandlers ?? []) {
        expect(getTriggerHandler(handler.type)).toBe(handler);
      }
    }
  });

  it('exposes source handlers only for connectable modules', () => {
    const handlers = listModuleSourceHandlers();
    expect(Object.keys(handlers).sort()).toEqual(['gmail', 'local_folder', 'slack']);
  });
});
