import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { SourceDescriptor } from '../schema.js';

type SnapshotsByExample = Record<string, Record<string, TableArtifact>>;

/** Example `exampleId` reads `sourceId`'s table under `sharedId` (the first example's file). */
export interface InputBinding {
  exampleId: string;
  sharedId: string;
  sourceId: string;
}

export interface InputPairing {
  snapshotsByExample: SnapshotsByExample;
  /** Only where an example reads a file under another file's id; empty when unpaired. */
  bindings: InputBinding[];
}

export interface PairingExample {
  id: string;
  /** File names of the example's results ("매출보고서_2026-08.pdf"). */
  outputNames: readonly string[];
}

/** Bijections tried per role when file names do not settle it (3 examples: 6). */
const MAX_ASSIGNMENTS_PER_ROLE = 24;
/** Snapshot sets replayed in total, including the unpaired one. */
const MAX_PAIRINGS = 8;

/**
 * The ways each example can read "its own" copy of a source that changes every period.
 *
 * Several examples are usually several periods: August's report was made from August's export,
 * September's from September's. Discovery saw every file for every example, and a rule found on
 * the first example names the first example's file, so it was checked against the other periods'
 * reports with the wrong month's data and nothing was learned.
 *
 * Files play the same role when their tables have the same columns (and, among more than one such
 * family, the same name apart from digits). For a role with a file per example, each pairing
 * puts one file under one source id for every example (the first example's file id, the name the
 * candidates use). The caller replays each returned set and keeps the one that explains the most;
 * the unpaired set is always included, so a report that really uses two same-shaped files (two
 * branches) is not broken by pairing.
 *
 * Order is preference: a pairing the file names point to (shared digits: _08 with _08), then the
 * unpaired set, then the other pairings.
 */
export function inputPairings(params: {
  examples: readonly PairingExample[];
  sources: readonly SourceDescriptor[];
  snapshotsByExample: SnapshotsByExample;
}): InputPairing[] {
  const { examples, sources, snapshotsByExample } = params;
  const unpaired: InputPairing = { snapshotsByExample, bindings: [] };
  if (examples.length < 2) return [unpaired];

  const tables = new Map<string, TableArtifact>();
  for (const example of examples) {
    for (const [sourceId, table] of Object.entries(snapshotsByExample[example.id] ?? {})) {
      if (!tables.has(sourceId)) tables.set(sourceId, table);
    }
  }
  const labels = new Map(sources.map((source) => [source.id, source.label]));

  const roles: RoleOptions[] = [];
  for (const members of sameRoleGroups([...tables.keys()], tables, labels, examples.length)) {
    const options = roleAssignments(members, examples, snapshotsByExample, labels);
    if (options) roles.push(options);
  }
  if (roles.length === 0) return [unpaired];

  const named = roles.every((role) => role.named !== undefined)
    ? [roles.map((role) => ({ members: role.members, assignment: role.named! }))]
    : [];
  const others: RoleChoice[][] = [];
  for (const combination of product(roles.map((role) => role.all.map((assignment) => ({ members: role.members, assignment }))))) {
    if (named.length > 0 && sameCombination(combination, named[0]!)) continue;
    others.push(combination);
    if (others.length >= MAX_PAIRINGS) break;
  }
  return [...named, 'unpaired' as const, ...others]
    .slice(0, MAX_PAIRINGS)
    .map((combination) => combination === 'unpaired'
      ? unpaired
      : applyAssignments(combination, examples, snapshotsByExample, tables));
}

/** Example id -> the source id that example reads for one role. */
type Assignment = Record<string, string>;

interface RoleChoice {
  members: readonly string[];
  assignment: Assignment;
}

interface RoleOptions {
  /** Every file of the role, assigned or not. */
  members: readonly string[];
  /** Every possible assignment, best named first. */
  all: Assignment[];
  /** The one assignment the file names single out, if any. */
  named?: Assignment;
}

function columnSignature(table: TableArtifact): string {
  return JSON.stringify(table.columns.map((column) => column.name.normalize('NFC').trim()).sort());
}

function nameFamily(label: string | undefined): string {
  return (label ?? '').normalize('NFC').toLowerCase().replace(/\d+/g, '#');
}

/**
 * Groups of sources that can stand for one another across periods: the same columns; when that
 * is more files than examples, the same columns and the same name apart from digits.
 */
function sameRoleGroups(
  sourceIds: readonly string[],
  tables: ReadonlyMap<string, TableArtifact>,
  labels: ReadonlyMap<string, string>,
  exampleCount: number,
): string[][] {
  const bySignature = new Map<string, string[]>();
  for (const sourceId of sourceIds) {
    const signature = columnSignature(tables.get(sourceId)!);
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), sourceId]);
  }
  const groups: string[][] = [];
  for (const members of bySignature.values()) {
    if (members.length < 2) continue;
    if (members.length <= exampleCount) {
      groups.push(members);
      continue;
    }
    const byFamily = new Map<string, string[]>();
    for (const sourceId of members) {
      const family = nameFamily(labels.get(sourceId));
      byFamily.set(family, [...(byFamily.get(family) ?? []), sourceId]);
    }
    for (const family of byFamily.values()) if (family.length >= 2) groups.push(family);
  }
  return groups;
}

function digitTokens(text: string): Set<number> {
  return new Set([...text.matchAll(/\d+/g)].map((match) => Number(match[0])));
}

/** How strongly the names tie an example to a file: digit runs both contain (08 and 8 alike). */
function nameScore(example: PairingExample, label: string | undefined): number {
  const fileDigits = digitTokens(label ?? '');
  let shared = 0;
  for (const name of example.outputNames) {
    for (const token of digitTokens(name)) if (fileDigits.has(token)) shared += 1;
  }
  return shared;
}

function roleAssignments(
  members: readonly string[],
  examples: readonly PairingExample[],
  snapshotsByExample: SnapshotsByExample,
  labels: ReadonlyMap<string, string>,
): RoleOptions | undefined {
  // Each example can only read files it was given.
  const choices = examples.map((example) =>
    members.filter((sourceId) => Object.hasOwn(snapshotsByExample[example.id] ?? {}, sourceId)));
  if (choices.some((choice) => choice.length === 0)) return undefined;
  // One file every example shares is not a per-period source.
  if (choices.every((choice) => choice.length === 1 && choice[0] === choices[0]![0])) return undefined;

  const scored: Array<{ assignment: Assignment; score: number }> = [];
  const walk = (index: number, used: Set<string>, assignment: Assignment, score: number): void => {
    if (scored.length >= MAX_ASSIGNMENTS_PER_ROLE) return;
    if (index === examples.length) {
      scored.push({ assignment: { ...assignment }, score });
      return;
    }
    const example = examples[index]!;
    for (const sourceId of choices[index]!) {
      if (used.has(sourceId)) continue;
      used.add(sourceId);
      assignment[example.id] = sourceId;
      walk(index + 1, used, assignment, score + nameScore(example, labels.get(sourceId)));
      used.delete(sourceId);
      delete assignment[example.id];
    }
  };
  const combinations = choices.reduce((total, choice) => total * choice.length, 1);
  if (combinations <= MAX_ASSIGNMENTS_PER_ROLE) {
    walk(0, new Set(), {}, 0);
  } else {
    // Too many files to try every pairing (a folder of monthly exports): only the names decide.
    const named = bestNamedPerExample(examples, choices, labels);
    if (!named) return undefined;
    return { members, all: [named], named };
  }
  if (scored.length === 0) return undefined;
  scored.sort((left, right) => right.score - left.score);
  const best = scored[0]!;
  // The only possible pairing (each example given its own file) or the one the names single out.
  const named = scored.length === 1 || (best.score > 0 && scored[1]!.score < best.score) ? best.assignment : undefined;
  return { members, all: scored.map((entry) => entry.assignment), named };
}

/** Each example's single best-named file, when every example has one and no two share it. */
function bestNamedPerExample(
  examples: readonly PairingExample[],
  choices: readonly string[][],
  labels: ReadonlyMap<string, string>,
): Assignment | undefined {
  const assignment: Assignment = {};
  const used = new Set<string>();
  for (const [index, example] of examples.entries()) {
    const ranked = choices[index]!
      .map((sourceId) => ({ sourceId, score: nameScore(example, labels.get(sourceId)) }))
      .sort((left, right) => right.score - left.score);
    const [first, second] = ranked;
    if (!first || first.score === 0 || (second && second.score === first.score) || used.has(first.sourceId)) return undefined;
    used.add(first.sourceId);
    assignment[example.id] = first.sourceId;
  }
  return assignment;
}

function* product<T>(lists: readonly T[][]): Generator<T[]> {
  if (lists.length === 0) {
    yield [];
    return;
  }
  const [head, ...rest] = lists;
  for (const first of head!) {
    for (const tail of product(rest)) yield [first, ...tail];
  }
}

function sameCombination(left: readonly RoleChoice[], right: readonly RoleChoice[]): boolean {
  return left.every((choice, index) => JSON.stringify(choice.assignment) === JSON.stringify(right[index]!.assignment));
}

/**
 * Snapshots where, for every role, each example reads its assigned file under one shared id:
 * the first example's file, which is what candidates enumerated on the first example name.
 * The role's other files are dropped: they belong to periods no example shows.
 */
function applyAssignments(
  combination: readonly RoleChoice[],
  examples: readonly PairingExample[],
  snapshotsByExample: SnapshotsByExample,
  tables: ReadonlyMap<string, TableArtifact>,
): InputPairing {
  const result: SnapshotsByExample = {};
  const bindings: InputBinding[] = [];
  for (const example of examples) result[example.id] = { ...(snapshotsByExample[example.id] ?? {}) };
  for (const { members, assignment } of combination) {
    const sharedId = assignment[examples[0]!.id]!;
    for (const example of examples) {
      const snapshots = result[example.id]!;
      for (const member of members) delete snapshots[member];
      const sourceId = assignment[example.id]!;
      snapshots[sharedId] = tables.get(sourceId)!;
      if (sourceId !== sharedId) bindings.push({ exampleId: example.id, sharedId, sourceId });
    }
  }
  return { snapshotsByExample: result, bindings };
}
