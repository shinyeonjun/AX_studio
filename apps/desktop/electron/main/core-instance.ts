import type { createAxStudioCore } from '@ax-studio/core';

export type AxCore = Awaited<ReturnType<typeof createAxStudioCore>>;

let core: AxCore | null = null;

export function setCore(instance: AxCore) {
  core = instance;
}

export function getCore(): AxCore {
  if (!core) throw new Error('AX Studio core is not initialized');
  return core;
}

/** Returns the initialized core during shutdown without turning a partial startup into another error. */
export function getCoreIfInitialized(): AxCore | null {
  return core;
}
