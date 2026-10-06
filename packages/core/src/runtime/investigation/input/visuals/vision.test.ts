import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visionInputsFromRun } from './vision.js';

const PNG = Buffer.from([137, 80, 78, 71, 1, 2, 3]);

describe('visionInputsFromRun path containment', () => {
  let base: string;
  let root: string;
  let outside: string;
  const previousRoot = process.env.AX_DOCUMENT_ARTIFACT_ROOT;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'ax-vision-root-'));
    root = join(base, 'artifacts');
    outside = join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    process.env.AX_DOCUMENT_ARTIFACT_ROOT = root;
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.AX_DOCUMENT_ARTIFACT_ROOT;
    else process.env.AX_DOCUMENT_ARTIFACT_ROOT = previousRoot;
    await rm(base, { recursive: true, force: true });
  });

  const run = (imagePath: string) => visionInputsFromRun({}, {
    ingest: { pages: [{ index: 0, hasVisual: true, imagePath }] },
  });

  it('reads images inside the artifact root', async () => {
    const imagePath = join(root, 'page-0.png');
    await writeFile(imagePath, PNG);
    const images = await run(imagePath);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ mimeType: 'image/png', pageIndex: 0, filename: 'page-0.png' });
  });

  it('rejects images outside the artifact root', async () => {
    const imagePath = join(outside, 'secret.png');
    await writeFile(imagePath, PNG);
    await expect(run(imagePath)).rejects.toMatchObject({ code: 'vision_asset_outside_artifact_root' });
  });

  it('rejects traversal out of the artifact root', async () => {
    await writeFile(join(outside, 'secret.png'), PNG);
    await expect(run(join(root, '..', 'outside', 'secret.png')))
      .rejects.toMatchObject({ code: 'vision_asset_outside_artifact_root' });
  });

  it('rejects a missing file without probing outside the root', async () => {
    await expect(run(join(root, 'missing.png'))).rejects.toMatchObject({ code: 'vision_asset_outside_artifact_root' });
  });

  it('rejects a symlink inside the root that points outside it', async (context) => {
    const target = join(outside, 'secret.png');
    await writeFile(target, PNG);
    const link = join(root, 'link.png');
    try {
      await symlink(target, link, 'file');
    } catch {
      context.skip(); // Symlink creation needs extra privileges on some Windows hosts.
      return;
    }
    await expect(run(link)).rejects.toMatchObject({ code: 'vision_asset_outside_artifact_root' });
  });
});
