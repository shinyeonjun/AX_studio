import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runCommand } from '../agent/model/cli-process.js';
import { defaultArtifactRoot } from './paths.js';
import type {
  DocumentChunkHit,
  DocumentEngineRequest,
  DocumentEngineResponse,
  IngestDocumentOptions,
  IngestDocumentResult,
} from './types.js';

export interface DocumentEngineClientOptions {
  pythonPath?: string;
  workerScript?: string;
  artifactRoot?: string;
  timeoutMs?: number;
  workerCwd?: string;
}

export interface DocumentEngineClient {
  ping(): Promise<boolean>;
  ingest(path: string, options?: IngestDocumentOptions): Promise<IngestDocumentResult>;
  getChunk(documentId: string, chunkId: string): Promise<{ chunk: Record<string, unknown> }>;
  getPage(documentId: string, pageIndex: number): Promise<{ page: Record<string, unknown>; text: string | null }>;
  search(documentId: string, query: string): Promise<{ hits: DocumentChunkHit[] }>;
}

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

const WORKER_REL = join('packages', 'document-engine', 'src', 'worker.py');

function findUp(start: string, relativePath: string, maxHops = 10): string | undefined {
  let dir = start;
  for (let i = 0; i < maxHops; i += 1) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function pythonInVenv(engineRoot: string): string {
  return process.platform === 'win32'
    ? join(engineRoot, '.venv', 'Scripts', 'python.exe')
    : join(engineRoot, '.venv', 'bin', 'python');
}

/** Walk from bundled Electron main and cwd — import.meta.url is not the source tree after vite bundle. */
export function defaultWorkerScript(): string {
  const fromEnv = process.env.AX_DOCUMENT_ENGINE_WORKER;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  return (
    findUp(moduleDir(), WORKER_REL) ??
    findUp(process.cwd(), WORKER_REL) ??
    join(moduleDir(), '../../../document-engine/src/worker.py')
  );
}

export function defaultPythonPath(): string {
  const fromEnv = process.env.AX_DOCUMENT_ENGINE_PYTHON;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const worker = defaultWorkerScript();
  const engineRoot = dirname(dirname(worker));
  const venvPython = pythonInVenv(engineRoot);
  if (existsSync(venvPython)) return venvPython;

  return process.platform === 'win32' ? 'python' : 'python3';
}

export function defaultWorkerCwd(workerScript: string): string {
  return dirname(workerScript);
}

let configuredClient: DocumentEngineClient | null = null;

export function setDocumentEngineClient(client: DocumentEngineClient | null): void {
  configuredClient = client;
}

export function getDocumentEngineClient(): DocumentEngineClient {
  if (!configuredClient) {
    configuredClient = new StdioDocumentEngineClient();
  }
  return configuredClient;
}

export class StdioDocumentEngineClient implements DocumentEngineClient {
  private readonly pythonPath: string;
  private readonly workerScript: string;
  private readonly artifactRoot: string;
  private readonly timeoutMs: number;
  private readonly workerCwd: string;

  constructor(options: DocumentEngineClientOptions = {}) {
    this.workerScript = options.workerScript ?? defaultWorkerScript();
    this.pythonPath = options.pythonPath ?? defaultPythonPath();
    this.artifactRoot = options.artifactRoot ?? defaultArtifactRoot();
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.workerCwd = options.workerCwd ?? defaultWorkerCwd(this.workerScript);
  }

  async ping(): Promise<boolean> {
    const response = await this.request<{ engine: string }>('ping', {});
    return response.ok;
  }

  async ingest(path: string, options: IngestDocumentOptions = {}): Promise<IngestDocumentResult> {
    const response = await this.request<IngestDocumentResult>('ingest', {
      path,
      artifactRoot: this.artifactRoot,
      options,
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'document_ingest_failed');
    }
    return response.data;
  }

  async getChunk(documentId: string, chunkId: string): Promise<{ chunk: Record<string, unknown> }> {
    const response = await this.request<{ chunk: Record<string, unknown> }>('get_chunk', {
      documentId,
      chunkId,
      artifactRoot: this.artifactRoot,
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'document_get_chunk_failed');
    }
    return response.data;
  }

  async getPage(
    documentId: string,
    pageIndex: number,
  ): Promise<{ page: Record<string, unknown>; text: string | null }> {
    const response = await this.request<{ page: Record<string, unknown>; text: string | null }>('get_page', {
      documentId,
      pageIndex,
      artifactRoot: this.artifactRoot,
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'document_get_page_failed');
    }
    return response.data;
  }

  async search(documentId: string, query: string): Promise<{ hits: DocumentChunkHit[] }> {
    const response = await this.request<{ hits: DocumentChunkHit[] }>('search', {
      documentId,
      query,
      artifactRoot: this.artifactRoot,
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'document_search_failed');
    }
    return response.data;
  }

  private async request<T>(command: string, params: Record<string, unknown>): Promise<DocumentEngineResponse<T>> {
    const payload: DocumentEngineRequest = {
      id: randomUUID(),
      command,
      params,
    };

    if (!existsSync(this.workerScript)) {
      throw new Error(
        `document_engine_worker_missing:${this.workerScript}. packages/document-engine 경로를 확인하세요.`,
      );
    }

    const result = await runCommand(this.pythonPath, [this.workerScript], {
      timeoutMs: this.timeoutMs,
      cwd: this.workerCwd,
      input: JSON.stringify(payload),
      env: { ...process.env, PYTHONUTF8: '1' },
    });

    const stdout = result.stdout.trim();
    if (!stdout) {
      const detail = result.stderr.trim() || `python=${this.pythonPath} worker=${this.workerScript}`;
      throw new Error(`document_engine_empty_response:${detail}`);
    }

    let parsed: DocumentEngineResponse<T>;
    try {
      parsed = JSON.parse(stdout) as DocumentEngineResponse<T>;
    } catch {
      throw new Error(`document_engine_invalid_json:${stdout.slice(0, 200)}`);
    }

    if (result.exitCode !== 0 && parsed.ok) {
      throw new Error(`document_engine_exit_${result.exitCode}`);
    }

    return parsed;
  }
}

export class MockDocumentEngineClient implements DocumentEngineClient {
  documents = new Map<string, IngestDocumentResult>();

  async ping(): Promise<boolean> {
    return true;
  }

  async ingest(path: string, options: IngestDocumentOptions = {}): Promise<IngestDocumentResult> {
    const documentId = `mock-${Buffer.from(path).toString('hex').slice(0, 16)}`;
    const summary = {
      pageCount: 1,
      chunkCount: 1,
      tableCount: 0,
      imageCount: 0,
      visualPageCount: 0,
      visualPages: [],
      engine: options.engine ?? 'mock',
    };
    const result: IngestDocumentResult = {
      documentId,
      artifactPath: `/mock/documents/${documentId}`,
      engine: summary.engine,
      summary,
    };
    this.documents.set(documentId, result);
    return result;
  }

  async getChunk(documentId: string, chunkId: string): Promise<{ chunk: Record<string, unknown> }> {
    if (!this.documents.has(documentId)) throw new Error('document_not_found');
    return { chunk: { id: chunkId, pageIndex: 0, kind: 'paragraph', text: 'mock chunk' } };
  }

  async getPage(
    documentId: string,
    pageIndex: number,
  ): Promise<{ page: Record<string, unknown>; text: string | null }> {
    if (!this.documents.has(documentId)) throw new Error('document_not_found');
    return {
      page: { index: pageIndex, hasVisual: false, ocrConfidence: null },
      text: 'mock page text',
    };
  }

  async search(documentId: string, query: string): Promise<{ hits: DocumentChunkHit[] }> {
    if (!this.documents.has(documentId)) throw new Error('document_not_found');
    return {
      hits: query
        ? [{ chunkId: 'c0', pageIndex: 0, snippet: `mock:${query}`, score: 1 }]
        : [],
    };
  }
}
