import type { OutputContract, OutputContractField, OutputContractValueKind } from '../../contracts/output-contract.js';
import type { OutputObservation, ObservationValue } from '../observation/schema.js';

/**
 * How far a later run may move from the examples before it is held as an anomaly. Two or three
 * monthly examples say little about next month: sales growing 25% or a few more categories is
 * normal. The guard is for values that are clearly wrong (a unit slip, double counting, wrong
 * data), so the band is wide: up to the largest example plus 100% of it.
 */
const DEFAULT_NUMERIC_TOLERANCE_RATIO = 1;
const DEFAULT_ROW_COUNT_TOLERANCE_RATIO = 1;

function observationValuesForPath(
  observations: OutputObservation[],
  path: string,
): ObservationValue[] {
  return observations
    .filter((observation) => observation.required && observation.path === path)
    .map((observation) => observation.value);
}

function finiteNumbers(values: ObservationValue[]): number[] {
  return values.flatMap((value) =>
    value.kind === 'number' && Number.isFinite(value.value) ? [value.value] : [],
  );
}

function rowCounts(values: ObservationValue[]): number[] {
  return values.flatMap((value) => value.kind === 'table' ? [value.rows.length] : []);
}

function buildField(path: string, values: ObservationValue[]): OutputContractField | undefined {
  const first = values[0];
  if (!first) return undefined;
  const kind = first.kind as OutputContractValueKind;
  const matching = values.filter((value) => value.kind === kind);
  const baseline: OutputContractField['baseline'] = {
    sampleCount: matching.length,
  };

  if (kind === 'number') {
    const numbers = finiteNumbers(matching);
    if (numbers.length > 0) {
      baseline.numericMin = Math.min(...numbers);
      baseline.numericMax = Math.max(...numbers);
      if (numbers.length >= 2) baseline.numericToleranceRatio = DEFAULT_NUMERIC_TOLERANCE_RATIO;
    }
  }

  if (kind === 'table') {
    const counts = rowCounts(matching);
    if (counts.length > 0) {
      baseline.rowCountMin = Math.min(...counts);
      baseline.rowCountMax = Math.max(...counts);
      if (counts.length >= 2) baseline.rowCountToleranceRatio = DEFAULT_ROW_COUNT_TOLERANCE_RATIO;
    }
  }

  return {
    path,
    kind,
    required: true,
    baseline,
  };
}

/** Builds a compact contract from required historical observations. */
export function buildOutputContract(observations: OutputObservation[]): OutputContract {
  const paths = [...new Set(
    observations
      .filter((observation) => observation.required)
      .map((observation) => observation.path),
  )];
  const fields = paths.flatMap((path) => {
    const field = buildField(path, observationValuesForPath(observations, path));
    return field ? [field] : [];
  });

  return {
    version: 1,
    fields,
    inputSchemas: [],
  };
}
