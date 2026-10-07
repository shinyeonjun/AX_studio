import type { DiscoverySessionState } from '../schema.js';
import type { WorkDiscoveryRuntime } from './contracts.js';

/** "매출보고서_2026-08.pdf" -> "매출보고서": the name without extension, periods and copy marks. */
function fileStem(fileName: string): string {
  return fileName
    .normalize('NFC')
    .replace(/\.[^./\\]+$/u, '')
    .replace(/\(\d+\)/gu, ' ')
    .replace(/\d+/gu, ' ')
    .replace(/[\s_\-.~·]+/gu, ' ')
    .trim();
}

/**
 * What the examples are, named by their result files when they all share one name apart from the
 * period ("매출보고서_2026-08.pdf", "매출보고서_2026-09.pdf" -> "매출보고서 만들기"). The request
 * that started discovery is often a generic "do it like last time", which names nothing.
 */
export function learnedWorkName(fileNames: readonly string[]): string | undefined {
  const stems = new Set(fileNames.map(fileStem));
  if (stems.size !== 1) return undefined;
  const [stem] = stems;
  return stem ? `${stem.slice(0, 60)} 만들기` : undefined;
}

export function defaultLearnedWorkName(runtime: WorkDiscoveryRuntime, state: DiscoverySessionState): string | undefined {
  const fileNames = runtime.store.listDiscoveryExamples(state.id)
    .flatMap((example) => example.outputArtifactIds.flatMap((artifactId) => runtime.artifactStore?.get(artifactId)?.fileName ?? []));
  return learnedWorkName(fileNames);
}
