import { performance } from 'node:perf_hooks';
import { expressionSignature } from './cases.mjs';

const VARIANTS = ['full', 'without_replay', 'without_clarification'];

export const METRIC_DEFINITIONS = Object.freeze({
  correctPublishRate: {
    numerator: 'cases where expected=publish and the variant publishes the gold source/expression and passes holdout',
    denominator: 'cases where expected=publish',
    eligible: 'positive publish cases',
  },
  falsePublishRate: {
    numerator: 'published cases that are not correctPublish',
    denominator: 'published cases',
    eligible: 'all cases the variant published',
  },
  falsePublishRateAmongExpectedNonPublish: {
    numerator: 'cases where expected is clarify/no_match and the variant publishes',
    denominator: 'cases where expected is clarify/no_match',
    eligible: 'negative decision cases',
  },
  safeDecisionRate: {
    numerator: 'cases where actual outcome equals expected outcome',
    denominator: 'all evaluated cases',
    eligible: 'all cases',
  },
  holdoutOutputAccuracy: {
    numerator: 'positive publish cases that publish the gold source/expression and pass hidden holdout',
    denominator: 'cases where expected=publish',
    eligible: 'positive publish cases',
  },
  holdoutPassRate: {
    numerator: 'published cases with a tested hidden holdout that passes',
    denominator: 'published cases with a tested hidden holdout',
    eligible: 'published cases where holdout was evaluated',
  },
  sourceRecoveryAccuracy: {
    numerator: 'positive publish cases that publish an allowed gold source',
    denominator: 'cases where expected=publish',
    eligible: 'positive publish cases',
  },
});

function sourceIdFromExpression(expression) {
  if (expression.op === 'source') return expression.sourceId;
  if ('input' in expression) return sourceIdFromExpression(expression.input);
  if (expression.op === 'ratio') {
    return sourceIdFromExpression(expression.numerator) ?? sourceIdFromExpression(expression.denominator);
  }
  return undefined;
}

function stableCandidateSignature(candidate) {
  return `${sourceIdFromExpression(candidate.expr) ?? 'unknown'}:${expressionSignature(candidate.expr)}`;
}

function candidateToEnumerated(candidate) {
  return {
    id: candidate.id,
    observationPath: candidate.observationPath,
    expr: candidate.expr,
    simplicity: candidate.score?.simplicity ?? candidate.simplicity ?? 0,
  };
}

function replayExamples(examples) {
  return examples.map((example) => ({
    exampleId: example.id,
    observations: example.observations,
  }));
}

function sourceEvidence(source) {
  return {
    id: source.id,
    connector: source.connector,
    label: source.label,
    kind: source.kind,
  };
}

function observationEvidence(observation) {
  return {
    path: observation.path,
    label: observation.label,
    value: observation.value,
    required: observation.required,
  };
}

function snapshotEvidence(snapshot) {
  return {
    id: snapshot.id,
    name: snapshot.name,
    columns: snapshot.columns.map((column) => ({ name: column.name, type: column.type })),
    rowCount: snapshot.rows.length,
    truncated: snapshot.truncated === true,
    source: snapshot.source,
  };
}

function candidateEvidence(candidate) {
  return {
    observationPath: candidate.observationPath,
    expression: candidate.expr,
    signature: expressionSignature(candidate.expr),
    score: candidate.score,
    status: candidate.status,
    replayResults: candidate.replayResults,
  };
}

function buildTrainingEvidence(item, training) {
  return {
    exampleIds: item.examples.map((example) => example.id),
    sources: item.sources.map(sourceEvidence),
    observations: item.examples.map((example) => ({
      exampleId: example.id,
      observations: example.observations.map(observationEvidence),
    })),
    snapshots: item.examples.map((example) => ({
      exampleId: example.id,
      sources: Object.fromEntries(Object.entries(example.snapshots).map(([sourceId, snapshot]) => [
        sourceId,
        snapshotEvidence(snapshot),
      ])),
    })),
    candidateCount: training.enumerated.length,
    replayedCount: training.replayedRaw.length,
    acceptedCount: training.resolved.candidates.filter((candidate) => candidate.status === 'accepted').length,
    ambiguousPaths: training.resolved.ambiguousPaths,
    candidates: training.resolved.candidates.map(candidateEvidence),
  };
}

function buildHoldoutEvidence(item) {
  return item.holdout.map((example) => ({
    exampleId: example.id,
    observations: example.observations.map(observationEvidence),
    snapshots: Object.fromEntries(Object.entries(example.snapshots).map(([sourceId, snapshot]) => [
      sourceId,
      snapshotEvidence(snapshot),
    ])),
  }));
}

function snapshotsByExample(examples) {
  return Object.fromEntries(examples.map((example) => [example.id, example.snapshots]));
}

function requiredPaths(item) {
  return [...new Set(item.examples.flatMap((example) =>
    example.observations.filter((observation) => observation.required).map((observation) => observation.path)))];
}

function bestCandidate(candidates, byReplay) {
  return [...candidates].sort((left, right) => {
    const leftPrimary = byReplay ? left.score?.total ?? 0 : left.simplicity ?? 0;
    const rightPrimary = byReplay ? right.score?.total ?? 0 : right.simplicity ?? 0;
    if (rightPrimary !== leftPrimary) return rightPrimary - leftPrimary;
    const leftSecondary = byReplay ? left.score?.replay ?? 0 : 0;
    const rightSecondary = byReplay ? right.score?.replay ?? 0 : 0;
    if (rightSecondary !== leftSecondary) return rightSecondary - leftSecondary;
    return stableCandidateSignature(left).localeCompare(stableCandidateSignature(right));
  })[0];
}

function everyReplayPass(candidate) {
  return candidate?.replayResults?.length > 0 && candidate.replayResults.every((entry) => entry.pass);
}

function runTraining(item, core) {
  const observations = item.examples.flatMap((example) => example.observations);
  const enumerated = core.enumerateCandidates(
    observations,
    item.sources,
    item.examples[0]?.snapshots ?? {},
  );
  const replayedRaw = core.replayCandidates({
    candidates: enumerated,
    examples: replayExamples(item.examples),
    snapshotsByExample: snapshotsByExample(item.examples),
  });
  const resolved = core.resolveReplayWinners(replayedRaw, requiredPaths(item));
  return { observations, enumerated, replayedRaw, resolved };
}

function holdoutResult(item, candidate, core) {
  if (!candidate) return { tested: false, pass: false, replayResults: [] };
  const replayed = core.replayCandidates({
    candidates: [candidateToEnumerated(candidate)],
    examples: replayExamples(item.holdout),
    snapshotsByExample: snapshotsByExample(item.holdout),
  });
  const replayedCandidate = replayed[0];
  return {
    tested: true,
    pass: everyReplayPass(replayedCandidate),
    replayResults: replayedCandidate?.replayResults ?? [],
  };
}

function publishResult(candidate, item, core, variant, startedAt) {
  const holdout = holdoutResult(item, candidate, core);
  return {
    outcome: 'publish',
    candidate: candidate ? {
      sourceId: sourceIdFromExpression(candidate.expr),
      expression: candidate.expr,
      signature: expressionSignature(candidate.expr),
      replay: candidate.score?.replay,
      simplicity: candidate.score?.simplicity ?? candidate.simplicity,
    } : undefined,
    holdout,
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    variant,
  };
}

function noMatchResult(variant, startedAt) {
  return {
    outcome: 'no_match',
    holdout: { tested: false, pass: false, replayResults: [] },
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    variant,
  };
}

function clarifyResult(accepted, ambiguousPaths, item, core, variant, startedAt) {
  return {
    outcome: 'clarify',
    ambiguousPaths,
    candidateCount: accepted.length,
    candidates: accepted.map((candidate) => ({
      sourceId: sourceIdFromExpression(candidate.expr),
      signature: expressionSignature(candidate.expr),
      replay: candidate.score?.replay,
      simplicity: candidate.score?.simplicity,
    })),
    holdout: { tested: false, pass: false, replayResults: [] },
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    variant,
  };
}

function runFull(item, training, core) {
  const startedAt = performance.now();
  const accepted = training.resolved.candidates.filter((candidate) => candidate.status === 'accepted');
  const paths = requiredPaths(item);
  const covered = new Set(accepted.map((candidate) => candidate.observationPath));
  if (accepted.length === 0 || paths.some((path) => !covered.has(path))) {
    return noMatchResult('full', startedAt);
  }
  if (training.resolved.ambiguousPaths.length > 0) {
    return clarifyResult(accepted, training.resolved.ambiguousPaths, item, core, 'full', startedAt);
  }
  const selected = accepted.find((candidate) => candidate.observationPath === paths[0]);
  return publishResult(selected, item, core, 'full', startedAt);
}

function runWithoutReplay(item, training, core) {
  const startedAt = performance.now();
  const selected = bestCandidate(training.enumerated, false);
  return selected
    ? publishResult(selected, item, core, 'without_replay', startedAt)
    : noMatchResult('without_replay', startedAt);
}

function runWithoutClarification(item, training, core) {
  const startedAt = performance.now();
  const accepted = training.resolved.candidates.filter((candidate) => candidate.status === 'accepted');
  if (accepted.length === 0) return noMatchResult('without_clarification', startedAt);
  const selected = bestCandidate(accepted, true);
  return publishResult(selected, item, core, 'without_clarification', startedAt);
}

function scoreCase(item, variantResult) {
  const expected = item.expected.outcome;
  const published = variantResult.outcome === 'publish';
  const candidate = variantResult.candidate;
  const expressionCorrect = published && item.expected.expressionSignatures.includes(candidate?.signature);
  const sourceCorrect = published && item.expected.sourceIds.includes(candidate?.sourceId);
  const holdoutCorrect = published && variantResult.holdout.pass;
  const correctPublish = expected === 'publish' && published && expressionCorrect && sourceCorrect && holdoutCorrect;
  const correctDecision = expected === variantResult.outcome;
  const unsafePublish = published && !correctPublish;
  return {
    expected,
    actual: variantResult.outcome,
    correctDecision,
    correctPublish,
    unsafePublish,
    expressionCorrect,
    sourceCorrect,
    holdoutCorrect,
  };
}

export function runBenchmarkCase(item, core) {
  const startedAt = performance.now();
  const training = runTraining(item, core);
  const variants = {
    full: runFull(item, training, core),
    without_replay: runWithoutReplay(item, training, core),
    without_clarification: runWithoutClarification(item, training, core),
  };
  const scored = Object.fromEntries(
    VARIANTS.map((variant) => [variant, {
      ...variants[variant],
      score: scoreCase(item, variants[variant]),
    }]),
  );
  return {
    id: item.id,
    domain: item.domain,
    title: item.title,
    finding: item.finding,
    expected: item.expected,
    training: {
      candidateCount: training.enumerated.length,
      replayedCount: training.replayedRaw.length,
      acceptedCount: training.resolved.candidates.filter((candidate) => candidate.status === 'accepted').length,
      ambiguousPaths: training.resolved.ambiguousPaths,
      evidence: buildTrainingEvidence(item, training),
    },
    holdout: buildHoldoutEvidence(item),
    variants: scored,
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
  };
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

export function aggregateMetrics(results) {
  return Object.fromEntries(VARIANTS.map((variant) => {
    const rows = results.map((result) => result.variants[variant]);
    const expectedPublish = rows.filter((row) => row.score.expected === 'publish');
    const expectedNonPublish = rows.filter((row) => row.score.expected !== 'publish');
    const published = rows.filter((row) => row.outcome === 'publish');
    const publishedWithHoldout = published.filter((row) => row.holdout.tested);
    const passedHoldout = publishedWithHoldout.filter((row) => row.holdout.pass).length;
    const correctDecision = rows.filter((row) => row.score.correctDecision).length;
    const correctPublish = rows.filter((row) => row.score.correctPublish).length;
    const unsafePublish = rows.filter((row) => row.score.unsafePublish).length;
    const expectedNonPublishPublished = rows.filter((row) => row.score.expected !== 'publish' && row.outcome === 'publish').length;
    const hiddenHoldoutGeneralizationFailures = rows.filter((row) =>
      row.outcome === 'publish' && row.holdout.tested && !row.holdout.pass,
    ).length;
    const sourceCorrect = rows.filter((row) => row.score.expected === 'publish' && row.score.sourceCorrect).length;
    const clarificationCount = rows.filter((row) => row.outcome === 'clarify').length;
    const latency = rows.reduce((sum, row) => sum + row.durationMs, 0);
    return [variant, {
      cases: rows.length,
      correctPublish: correctPublish,
      correctPublishRate: rate(correctPublish, expectedPublish.length),
      falsePublish: unsafePublish,
      falsePublishRate: rate(unsafePublish, published.length),
      falsePublishRateAmongExpectedNonPublish: rate(expectedNonPublishPublished, expectedNonPublish.length),
      safeDecisionRate: rate(correctDecision, rows.length),
      holdoutOutputAccuracy: rate(correctPublish, expectedPublish.length),
      holdoutPassRate: rate(passedHoldout, publishedWithHoldout.length),
      sourceRecoveryAccuracy: rate(sourceCorrect, expectedPublish.length),
      clarificationCount,
      clarificationRate: rate(clarificationCount, rows.length),
      averageDiscoveryLatencyMs: Number((latency / rows.length).toFixed(3)),
      denominators: {
        allCases: rows.length,
        expectedPublish: expectedPublish.length,
        expectedNonPublish: expectedNonPublish.length,
        actualPublish: published.length,
        publishedWithHoldout: publishedWithHoldout.length,
      },
      numerators: {
        correctPublish,
        unsafePublish,
        expectedNonPublishPublished,
        correctDecision,
        passedHoldout,
        sourceCorrect,
        hiddenHoldoutGeneralizationFailures,
      },
    }];
  }));
}

export { VARIANTS };
