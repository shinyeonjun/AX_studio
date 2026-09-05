import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function importBuilt(path) {
  await access(path);
  return import(pathToFileURL(path).href);
}

export async function loadCoreAdapter(repoRoot) {
  const synthesis = await importBuilt(join(
    repoRoot,
    'packages',
    'core',
    'dist',
    'work-discovery',
    'synthesis',
    'index.js',
  ));
  const evaluator = await importBuilt(join(
    repoRoot,
    'packages',
    'core',
    'dist',
    'workflow',
    'transform-expr',
    'evaluator.js',
  ));
  return {
    enumerateCandidates: synthesis.enumerateCandidates,
    replayCandidates: synthesis.replayCandidates,
    resolveReplayWinners: synthesis.resolveReplayWinners,
    evaluateTransformExpr: evaluator.evaluateTransformExpr,
  };
}
