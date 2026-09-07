import { defaultArtifactRoot, defaultTemplateRoot } from '../../paths.js';
import {
  defaultPythonPath,
  defaultWorkerCwd,
  defaultWorkerScript,
} from '../paths.js';
import type {
  DocumentChunkHit,
  IngestDocumentOptions,
  IngestDocumentResult,
  PdfFormAnalyzeOptions,
  PdfFormFillOptions,
  PdfFormFillResult,
  PdfFormTemplate,
  PdfReportPairAnalysis,
  PdfToHtmlOptions,
  PdfToHtmlResult,
  DocumentEngineResponse,
} from '../../types.js';
import type {
  DocumentEngineClient,
  DocumentEngineClientOptions,
} from '../contracts.js';
import { requestDocumentEngine, type DocumentEngineTransportOptions } from './request.js';

export class StdioDocumentEngineClient implements DocumentEngineClient {
  private readonly pythonPath: string;
  private readonly workerScript: string;
  private readonly artifactRoot: string;
  private readonly timeoutMs: number;
  private readonly workerCwd: string;

  constructor(options: DocumentEngineClientOptions = {}) {
    this.workerScript = options.workerScript ?? defaultWorkerScript();
    this.pythonPath = options.pythonPath ?? defaultPythonPath(this.workerScript);
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

  async pdfToHtml(path: string, options: PdfToHtmlOptions = {}): Promise<PdfToHtmlResult> {
    const response = await this.request<PdfToHtmlResult>('pdf_to_html', {
      path,
      templateRoot: defaultTemplateRoot(),
      options,
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'pdf_to_html_failed');
    }
    return response.data;
  }

  async pdfFormAnalyze(path: string, options: PdfFormAnalyzeOptions = {}): Promise<PdfFormTemplate> {
    const response = await this.request<PdfFormTemplate>('pdf_form_analyze', {
      path,
      templateRoot: defaultTemplateRoot(),
      options,
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'pdf_form_analyze_failed');
    }
    return response.data;
  }

  async pdfFormFill(path: string, options: PdfFormFillOptions): Promise<PdfFormFillResult> {
    const response = await this.request<PdfFormFillResult>('pdf_form_fill', {
      path,
      ...options,
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'pdf_form_fill_failed');
    }
    return response.data;
  }

  async pdfReportAnalyze(templatePath: string, examplePath: string): Promise<PdfReportPairAnalysis> {
    const response = await this.request<PdfReportPairAnalysis>('pdf_report_analyze', {
      templatePath,
      examplePath,
      artifactRoot: this.artifactRoot,
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'pdf_report_analyze_failed');
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
    const options: DocumentEngineTransportOptions = {
      pythonPath: this.pythonPath,
      workerScript: this.workerScript,
      artifactRoot: this.artifactRoot,
      timeoutMs: this.timeoutMs,
      workerCwd: this.workerCwd,
    };
    return requestDocumentEngine(options, command, params);
  }
}
