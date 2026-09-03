import { createHash } from 'node:crypto';
import type { InputContractColumnType, OutputContract } from '../../contracts/output-contract.js';
import {
  describeInputColumns,
  inputColumnTypesCompatible,
} from '../../runtime/output-contract.js';
import type { RepairCandidateOperation } from './contract.js';

function normalizedName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9가-힣]+/gu, ' ')
    .trim();
}

function stemToken(value: string): string {
  if (value.length > 4 && value.endsWith('s') && !/(ss|us|is)$/u.test(value)) {
    return value.slice(0, -1);
  }
  return value;
}

function nameTokens(value: string): string[] {
  return [...new Set(normalizedName(value).split(/\s+/u).filter(Boolean).map(stemToken))];
}

function columnNameSimilarity(expected: string, actual: string): number {
  const expectedTokens = nameTokens(expected);
  const actualTokens = nameTokens(actual);
  if (expectedTokens.length === 0 || actualTokens.length === 0) return 0;
  const actualSet = new Set(actualTokens);
  const overlap = expectedTokens.filter((token) => actualSet.has(token)).length;
  if (overlap === 0) return 0;
  const tokenScore = overlap / Math.max(expectedTokens.length, actualTokens.length);
  const firstTokenBonus = expectedTokens[0] === actualTokens[0] ? 0.15 : 0;
  return Math.min(1, tokenScore + firstTokenBonus);
}

function compatibleExpectedType(type: string): type is InputContractColumnType {
  return [
    'string',
    'number',
    'integer',
    'boolean',
    'date',
    'datetime',
    'currency',
    'percentage',
    'unknown',
  ].includes(type);
}

function candidateId(
  sourceId: string,
  stepId: string,
  from: string,
  to: string,
): string {
  return `repair_${createHash('sha256')
    .update(`${sourceId}\0${stepId}\0${from}\0${to}`)
    .digest('hex')
    .slice(0, 20)}`;
}

/**
 * Suggests only source-column rename candidates. It reads the input schema,
 * but never copies a row or cell value into a candidate.
 */
export function suggestRepairCandidates(
  contract: OutputContract,
  stepId: string,
  data: unknown,
): RepairCandidateOperation[] {
  const schemas = contract.inputSchemas.filter((entry) => entry.stepId === stepId);
  const actualColumns = describeInputColumns(data);
  if (schemas.length === 0 || !actualColumns) return [];

  const actualByName = new Map(actualColumns.map((column) => [column.name, column]));
  const candidates: Array<RepairCandidateOperation & { score: number }> = [];
  for (const schema of schemas) {
    for (const expected of schema.columns) {
      if (actualByName.has(expected.name)) continue;
      if (!compatibleExpectedType(expected.type) || expected.type === 'unknown') continue;

      const matches = actualColumns
        .filter((actual) => inputColumnTypesCompatible(expected.type, actual.type))
        .map((actual) => ({ actual, score: columnNameSimilarity(expected.name, actual.name) }))
        .filter((entry) => entry.score >= 0.45)
        .sort((left, right) => right.score - left.score || left.actual.name.localeCompare(right.actual.name));
      const best = matches[0];
      if (!best) continue;
      candidates.push({
        id: candidateId(schema.sourceId, schema.stepId, expected.name, best.actual.name),
        op: 'rename_column',
        sourceId: schema.sourceId,
        stepId: schema.stepId,
        from: expected.name,
        to: best.actual.name,
        expectedType: expected.type,
        actualType: best.actual.type,
        confidence: best.score,
        score: best.score,
      });
    }
  }

  const targetCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.sourceId}\0${candidate.stepId}\0${candidate.to}`;
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }

  return candidates
    .filter((candidate) => targetCounts.get(`${candidate.sourceId}\0${candidate.stepId}\0${candidate.to}`) === 1)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 20)
    .map(({ score: _score, ...candidate }) => candidate);
}
