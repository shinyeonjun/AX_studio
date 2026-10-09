import type { DocumentEngineClient } from '../../read/engine-client.js';
import type { PdfReportValueRemoval } from '../../read/types.js';
import type { Connector, ExecutionLogEntry } from '../../../connectors/types.js';
import type {
  ReportSourceNeed,
  ReportUnavailableSource,
  ReportBusinessInference,
  ReportCaptureInference,
} from '../planner/schema.js';
import type { ReportSourceInspection } from '../planner/source-discovery.js';
import type { ReportHttpConnectionSummary, ReportPlanReplayFailure } from '../planner/planner.js';
import type { captureReportSources } from '../source/capture.js';
import type { ReportHttpProbe, ReportHttpProbeCorrection } from '../source/probe.js';
import type { ReportCheckpointStore } from '../checkpoints.js';

interface ReportWorkspaceSourceResolver {
  resolveStoredFile(sessionId: string, sourceId: string): {
    source: { id: string; fileName: string; mimeType?: string };
    artifact: { storedPath: string };
  };
}

interface ReportPlanningGateway {
  forExecution?(stage: <T>(name: string, input: unknown, run: () => Promise<T>) => Promise<T>): ReportPlanningGateway;
  /** Which text of a completed report is this period's values (to be replaced), not the form. */
  inferExampleValues?(input: {
    goal: string;
    spans: Awaited<ReturnType<DocumentEngineClient['pdfReportSpans']>>;
    signal?: AbortSignal;
    log?: (entry: ExecutionLogEntry) => void;
  }): Promise<PdfReportValueRemoval[]>;
  inferSourceRequirements(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    connectedConnectors: string[];
    unavailableSources?: ReportUnavailableSource[];
    signal?: AbortSignal;
    log?: (entry: ExecutionLogEntry) => void;
  }): Promise<ReportSourceNeed[]>;
  inferCapturePlan(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    connectedConnectors: string[];
    requirements?: ReportSourceNeed[];
    unavailableSources?: ReportUnavailableSource[];
    previousCapture?: ReportCaptureInference;
    signal?: AbortSignal;
    log?: (entry: ExecutionLogEntry) => void;
    inspectSource?: (request: ReportSourceInspection, abortSignal?: AbortSignal) => Promise<unknown>;
  }): Promise<ReportCaptureInference>;
  refineCapturePlan?(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    provisional: ReportCaptureInference;
    httpProbes: ReportHttpProbe[];
    staticQueryCorrections?: ReportHttpProbeCorrection[];
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    connectedConnectors: string[];
    signal?: AbortSignal;
    log?: (entry: ExecutionLogEntry) => void;
  }): Promise<ReportCaptureInference>;
  inferReportPlan(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    capture: ReportCaptureInference;
    exampleSources: Awaited<ReturnType<typeof captureReportSources>>;
    connectedConnectors: string[];
  }): Promise<ReportBusinessInference>;
  reviseReportPlan?(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    capture: ReportCaptureInference;
    exampleSources: Awaited<ReturnType<typeof captureReportSources>>;
    previous: ReportBusinessInference;
    replayFailure: ReportPlanReplayFailure;
    connectedConnectors: string[];
  }): Promise<ReportBusinessInference>;
}

export interface ReportGenerationDependencies {
  checkpoints?: ReportCheckpointStore;
  workspaceSources: ReportWorkspaceSourceResolver;
  /** The span listing and blanking calls let a completed report stand in for its blank form. */
  documentEngine: Pick<DocumentEngineClient, 'pdfReportAnalyze' | 'pdfFormFill'>
    & Partial<Pick<DocumentEngineClient, 'pdfReportSpans' | 'pdfReportBlank'>>;
  planner: ReportPlanningGateway;
  getConnector(name: string): Connector | undefined;
  /** Test seam; production uses an owned OS temporary directory and cleans it. */
  makeTemporaryDirectory?: () => string;
}
