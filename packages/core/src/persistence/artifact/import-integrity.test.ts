import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    copyFileSync: (source: Parameters<typeof actual.copyFileSync>[0],
      destination: Parameters<typeof actual.copyFileSync>[1],
      mode?: Parameters<typeof actual.copyFileSync>[2]) => {
      actual.writeFileSync(source, 'source changed after hashing');
      return actual.copyFileSync(source, destination, mode);
    },
  };
});

import { ArtifactStore } from '../artifact-store.js';

describe('ArtifactStore import integrity', () => {
  it('persists the exact bytes whose digest is recorded', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifact-import-'));
    const source = join(root, 'source.bin');
    const original = Buffer.from('source bytes used for sha256');
    writeFileSync(source, original);

    const artifact = new ArtifactStore(join(root, 'artifacts')).importFile(source);
    const stored = readFileSync(artifact.storedPath);

    expect(stored).toEqual(original);
    expect(createHash('sha256').update(stored).digest('hex')).toBe(artifact.sha256);
  });

  it('replaces an orphaned stored file instead of recording a mismatched digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifact-orphan-'));
    const artifactRoot = join(root, 'artifacts');
    const source = join(root, 'source.bin');
    const original = Buffer.from('new source bytes');
    const id = 'artifact_1';
    mkdirSync(artifactRoot);
    writeFileSync(source, original);
    writeFileSync(join(artifactRoot, `${id}_source.bin`), 'orphaned old bytes');

    const artifact = new ArtifactStore(artifactRoot).importFile(source, { id });
    const stored = readFileSync(artifact.storedPath);

    expect(stored).toEqual(original);
    expect(createHash('sha256').update(stored).digest('hex')).toBe(artifact.sha256);
  });

  it('rejects a reused ID with different content without changing the existing artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-artifact-id-conflict-'));
    const artifactRoot = join(root, 'artifacts');
    const firstSource = join(root, 'first.bin');
    const secondSource = join(root, 'second.bin');
    const firstBytes = Buffer.from('original artifact');
    mkdirSync(artifactRoot);
    writeFileSync(firstSource, firstBytes);
    writeFileSync(secondSource, 'different artifact');
    const store = new ArtifactStore(artifactRoot);
    const first = store.importFile(firstSource, { id: 'artifact_1' });

    expect(() => store.importFile(secondSource, { id: 'artifact_1' }))
      .toThrow('Artifact id already exists with different content: artifact_1');
    expect(readFileSync(first.storedPath)).toEqual(firstBytes);
  });
});
