import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JEV_ROUTING_CASES, JEV_SCALE_ROUTING_CASES } from './routing-eval.cases.js';
import { HOLDOUT2_BASIC_CASES, HOLDOUT2_SCALE_CASES, HOLDOUT_BASIC_CASES, HOLDOUT_SCALE_CASES } from './routing-eval.holdout-cases.js';

/**
 * What Jev is told must not contain the requests it is scored on: an evaluation sentence used as
 * a prompt example measures recall of that example, not judgment. Every non-test source file
 * under intelligence/ and catalog/ is checked, since instructions are assembled from several.
 */
const src = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const CASES = [
  ...JEV_ROUTING_CASES, ...JEV_SCALE_ROUTING_CASES,
  ...HOLDOUT_BASIC_CASES, ...HOLDOUT_SCALE_CASES, ...HOLDOUT2_BASIC_CASES, ...HOLDOUT2_SCALE_CASES,
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'eval') sourceFiles(path, out);
    } else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

const compact = (text: string) => text.toLocaleLowerCase().replace(/슬랙/gu, 'slack').replace(/\s+/gu, '').replace(/[.?!]+$/u, '');

/** String literals with Korean in them: what reaches Jev as instructions, criteria, or examples. */
function koreanLiterals(source: string): string[] {
  // Comments never reach Jev.
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
  const literals = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/gu)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? '');
  // Quoted examples inside a longer instruction count on their own.
  return literals.flatMap((literal) => [literal, ...[...literal.matchAll(/"([^"]+)"|“([^”]+)”/gu)].map((quote) => quote[1] ?? quote[2] ?? '')])
    .filter((literal) => /\p{Script=Hangul}/u.test(literal));
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Dice similarity of character pairs: 1 for the same text, about 0.7 for one with a word swapped. */
function similarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  let shared = 0;
  for (const [gram, count] of a) shared += Math.min(count, b.get(gram) ?? 0);
  const total = Math.max(1, left.length - 1) + Math.max(1, right.length - 1);
  return (2 * shared) / total;
}

describe('evaluation requests stay out of prompts', () => {
  it('no prompt text quotes an evaluation request or a close copy of one', () => {
    const literals = [...sourceFiles(join(src, 'intelligence')), ...sourceFiles(join(src, 'catalog'))]
      .flatMap((path) => koreanLiterals(readFileSync(path, 'utf8')).map((literal) => ({ path: relative(src, path), literal, text: compact(literal) })));
    const leaks = new Set<string>();
    for (const testCase of CASES) {
      const message = compact(testCase.message);
      // Very short requests ("안녕") are ordinary words, not a copied example.
      if (message.length < 5) continue;
      for (const { path, literal, text } of literals) {
        // A label much shorter than the request ("Slack 채널 목록") names a thing; it is not a copied request.
        const copied = text.includes(message) || (text.length >= message.length * 0.85 && text.length <= message.length * 1.6 && similarity(text, message) >= 0.7);
        if (copied) leaks.add(`${path}: ${testCase.id} "${testCase.message}" ~ "${literal.slice(0, 80)}"`);
      }
    }
    expect([...leaks]).toEqual([]);
  });
});
