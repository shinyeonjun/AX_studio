import type { createAxStudioCore } from '@ax-studio/core';

export type AxCore = Awaited<ReturnType<typeof createAxStudioCore>>;

let core: AxCore | null = null;

export function setCore(instance: AxCore) {
  core = instance;
}

export function getCore(): AxCore {
  if (!core) throw new Error('앱이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
  return core;
}

/** Returns the initialized core during shutdown without turning a partial startup into another error. */
export function getCoreIfInitialized(): AxCore | null {
  return core;
}
