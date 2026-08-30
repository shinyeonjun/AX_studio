export type ProductQaMode = 'live' | 'deterministic';

export type ProductQaTier = 'handwritten' | 'smoke' | 'core' | 'full' | 'soak';

export type DefectSeverity = 'critical' | 'major' | 'minor';

export type ProductSurfaceArea =
  | 'nav'
  | 'chat'
  | 'session'
  | 'settings'
  | 'ai'
  | 'connector'
  | 'capability'
  | 'command'
  | 'document'
  | 'workflow'
  | 'discovery'
  | 'runtime';

export interface ProductScenario {
  id: string;
  name: string;
  description?: string;
  mode?: ProductQaMode;
  tags?: string[];
  covers?: string[];
  generated?: boolean;
  tier?: ProductQaTier;
  timeoutMs?: number;
  steps: ScenarioStep[];
}

export type ScenarioAction =
  | { action: 'newChat'; label?: string }
  | { action: 'sendMessage'; text: string; label?: string; waitForReply?: boolean }
  | { action: 'waitMs'; ms: number }
  | { action: 'waitForAssistantReply'; timeoutMs?: number; optional?: boolean }
  | { action: 'startDiscoveryFixture'; artifact: string; folder: string; label?: string }
  | { action: 'waitForDiscovery'; status: string; timeoutMs?: number }
  | { action: 'publishDiscovery'; name?: string }
  | { action: 'switchSession'; label?: string; titleContains?: string }
  | { action: 'deleteSession'; titleContains?: string; label?: string }
  | { action: 'attachFixture'; fixture: string; label?: string }
  | { action: 'openTab'; tab: 'work' | 'approval' | 'activity' | 'settings' }
  | { action: 'openSettings'; label: string }
  | { action: 'openAiSettings'; brand: 'Claude' | 'GPT' }
  | { action: 'toggleTheme' }
  | { action: 'openContextTab'; tab: '자료' | '흐름' }
  | { action: 'screenshot'; name: string };

export type ScenarioCheck =
  | {
      check: 'assistantMessageContains';
      text: string;
      label?: string;
      severity?: DefectSeverity;
    }
  | {
      check: 'assistantNonEmpty';
      minChars?: number;
      severity?: DefectSeverity;
    }
  | {
      check: 'userMessagePresent';
      text: string;
      label?: string;
      severity?: DefectSeverity;
    }
  | {
      check: 'sessionCountAtLeast';
      min: number;
      severity?: DefectSeverity;
    }
  | {
      check: 'noCrossSessionBleed';
      forbiddenInSession: string;
      text: string;
      severity?: DefectSeverity;
    }
  | {
      check: 'composerEnabled' | 'composerDisabled';
      severity?: DefectSeverity;
    }
  | {
      check: 'visibleTextContains';
      text: string;
      severity?: DefectSeverity;
    }
  | {
      check: 'visibleTextAbsent';
      text: string;
      severity?: DefectSeverity;
    }
  | {
      check: 'pageTitleIs';
      text: string;
      severity?: DefectSeverity;
    }
  | {
      check: 'noErrorBanner';
      severity?: DefectSeverity;
    }
  | {
      check: 'appAlive';
      severity?: DefectSeverity;
    }
  | {
      check: 'discoveryCardPresent' | 'discoveryCardAbsent';
      severity?: DefectSeverity;
    }
  | {
      check: 'workflowPresent';
      text: string;
      severity?: DefectSeverity;
    };

export type ScenarioStep = ScenarioAction | ScenarioCheck;

export interface StepMetric {
  stepIndex: number;
  step: ScenarioStep;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  detail?: string;
}

export interface DefectRecord {
  scenarioId: string;
  scenarioName: string;
  runIndex: number;
  stepIndex: number;
  check: string;
  severity: DefectSeverity;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface ScenarioRunResult {
  scenarioId: string;
  scenarioName: string;
  mode: ProductQaMode;
  runIndex: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: StepMetric[];
  defects: DefectRecord[];
  passed: boolean;
  error?: string;
  covers?: string[];
  generated?: boolean;
}

export interface ProductQaReport {
  runId: string;
  mode: ProductQaMode;
  startedAt: string;
  finishedAt: string;
  dataRoot: string;
  strict: boolean;
  tier?: ProductQaTier;
  scenarios: ScenarioRunResult[];
  coverage?: {
    total: number;
    covered: number;
    missing: string[];
  };
  summary: {
    scenarioRuns: number;
    passed: number;
    failed: number;
    defects: number;
    criticalDefects: number;
    medianReplyMs: number | null;
    p95ReplyMs: number | null;
  };
}
