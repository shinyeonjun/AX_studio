import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredArtifact } from '@ax-studio/core';

const electronMocks = vi.hoisted(() => ({
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() },
}));

vi.mock('electron', () => electronMocks);

import {
  exportGeneratedArtifact,
  resolveGeneratedArtifactSourcePath,
  type GeneratedArtifactExportDependencies,
} from './artifact-handlers.js';

function artifact(overrides: Partial<StoredArtifact> = {}): StoredArtifact {
  return {
    id: 'art_pdf_1',
    sha256: 'sha256',
    fileName: 'report.pdf',
    storedPath: 'C:/data/report.pdf',
    mimeType: 'application/pdf',
    size: 15,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('generated PDF export boundary', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
    vi.clearAllMocks();
  });

  it('copies a validated PDF through the user-selected destination without returning paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-pdf-export-'));
    roots.push(root);
    const sourcePath = join(root, 'stored-report.pdf');
    const destinationPath = join(root, 'exported-report.pdf');
    writeFileSync(sourcePath, '%PDF-1.7 fixture');
    const stored = artifact({ storedPath: sourcePath, size: 16 });
    const copy = vi.fn(async (source: string, destination: string) => {
      copyFileSync(source, destination);
    });
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: destinationPath }));
    const deps: GeneratedArtifactExportDependencies = {
      getArtifact: vi.fn(() => stored),
      resolveSourcePath: vi.fn(async () => sourcePath),
      showSaveDialog,
      copyFile: copy,
    };

    const result = await exportGeneratedArtifact('  art_pdf_1  ', deps);

    expect(result).toEqual({ ok: true, fileName: 'exported-report.pdf' });
    expect(result).not.toHaveProperty('path');
    expect(showSaveDialog).toHaveBeenCalledWith('report.pdf');
    expect(copy).toHaveBeenCalledWith(sourcePath, destinationPath);
    expect(readFileSync(destinationPath, 'utf8')).toBe('%PDF-1.7 fixture');
  });

  it('does not copy when the user cancels the native save dialog', async () => {
    const copy = vi.fn(async () => undefined);
    const deps: GeneratedArtifactExportDependencies = {
      getArtifact: vi.fn(() => artifact()),
      resolveSourcePath: vi.fn(async () => 'C:/data/report.pdf'),
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
      copyFile: copy,
    };

    await expect(exportGeneratedArtifact('art_pdf_1', deps)).resolves.toEqual({ ok: false, canceled: true });
    expect(copy).not.toHaveBeenCalled();
  });

  it('rejects invalid, missing, and non-PDF artifacts without opening a dialog', async () => {
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: 'C:/export.pdf' }));
    const resolveSourcePath = vi.fn(async () => 'C:/data/report.pdf');
    const deps: GeneratedArtifactExportDependencies = {
      getArtifact: vi.fn((id: string) => {
        if (id === 'missing') return undefined;
        if (id === 'text') return artifact({ mimeType: 'text/plain', fileName: 'report.txt' });
        throw new Error('Invalid artifact id: ../escaped');
      }),
      resolveSourcePath,
      showSaveDialog,
      copyFile: vi.fn(async () => undefined),
    };

    await expect(exportGeneratedArtifact('', deps)).resolves.toEqual({
      ok: false,
      error: 'PDF 결과물 ID가 필요합니다.',
    });
    await expect(exportGeneratedArtifact('missing', deps)).resolves.toEqual({
      ok: false,
      error: 'PDF 결과물을 찾을 수 없습니다.',
    });
    await expect(exportGeneratedArtifact('text', deps)).resolves.toEqual({
      ok: false,
      error: 'PDF 결과물 형식이 올바르지 않습니다.',
    });
    await expect(exportGeneratedArtifact('../escaped', deps)).resolves.toEqual({
      ok: false,
      error: 'PDF 결과물을 찾을 수 없습니다.',
    });
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(resolveSourcePath).not.toHaveBeenCalled();
  });

  it('returns a stable error when copying fails without exposing a filesystem path', async () => {
    const sourcePath = 'C:/private/report.pdf';
    const destinationPath = 'C:/private/export.pdf';
    const deps: GeneratedArtifactExportDependencies = {
      getArtifact: vi.fn(() => artifact({ storedPath: sourcePath })),
      resolveSourcePath: vi.fn(async () => sourcePath),
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: destinationPath })),
      copyFile: vi.fn(async () => {
        throw new Error(`EACCES: ${sourcePath}`);
      }),
    };

    const result = await exportGeneratedArtifact('art_pdf_1', deps);

    expect(result).toEqual({ ok: false, error: 'PDF 저장에 실패했습니다.' });
    expect(JSON.stringify(result)).not.toContain(sourcePath);
    expect(JSON.stringify(result)).not.toContain(destinationPath);
  });
});

describe('generated PDF source validation', () => {
  it('accepts only an existing regular file inside the generated-report root with matching size and hash', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'ax-pdf-source-'));
    const root = join(parent, 'reports');
    const outsidePath = join(parent, 'outside.pdf');
    const sourcePath = join(root, 'stored-report.pdf');
    rootsForSourceTest.push(parent);
    mkdirSync(root);
    writeFileSync(outsidePath, 'outside');
    writeFileSync(sourcePath, 'inside');
    const sha256 = createHash('sha256').update('inside').digest('hex');

    await expect(resolveGeneratedArtifactSourcePath(root, sourcePath, 6, sha256)).resolves.toBe(sourcePath);
    await expect(resolveGeneratedArtifactSourcePath(root, sourcePath, 5, sha256)).resolves.toBeUndefined();
    writeFileSync(sourcePath, 'damage');
    await expect(resolveGeneratedArtifactSourcePath(root, sourcePath, 6, sha256)).resolves.toBeUndefined();
    await expect(resolveGeneratedArtifactSourcePath(root, outsidePath, 7, sha256)).resolves.toBeUndefined();
  });
});

const rootsForSourceTest: string[] = [];

afterEach(() => {
  for (const root of rootsForSourceTest) rmSync(root, { recursive: true, force: true });
  rootsForSourceTest.length = 0;
});
