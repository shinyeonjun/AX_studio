import type { DesignToolContext } from '../../design-tools/types.js';
import { registerModule } from '../module-registry.js';
import { registerTriggerHandler } from '../../triggers/registry.js';
import { ALL_MODULE_PACKAGES } from './catalog.js';

export function listModuleSourceHandlers(): Record<string, (ctx: DesignToolContext) => unknown> {
  return Object.fromEntries(
    ALL_MODULE_PACKAGES.filter((pkg) => pkg.listSources).map((pkg) => [pkg.id, pkg.listSources!]),
  );
}

export function getModuleSourceFilesHandler(
  connector: string,
): ((ctx: DesignToolContext, args: Record<string, unknown>) => unknown) | undefined {
  return ALL_MODULE_PACKAGES.find((pkg) => pkg.id === connector)?.listSourceFiles;
}

export function registerAllModules(): void {
  for (const pkg of ALL_MODULE_PACKAGES) {
    registerModule({ id: pkg.id, ...pkg.registration });
    for (const handler of pkg.triggerHandlers ?? []) {
      registerTriggerHandler(handler);
    }
  }
}
