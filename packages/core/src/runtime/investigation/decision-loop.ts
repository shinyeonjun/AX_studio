import type { Connector, ConnectorContext } from '../../modules/types.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import { performCapabilityRead } from '../capability-read.js';
import { INVESTIGATION_LIMIT_MESSAGE } from './input.js';
import {
  hasDecisionEvidenceFromBindings,
  hasRequiredOutputFields,
  persistDecisionOutput,
} from './evidence.js';
import { requiredOutputFields } from './output.js';

const CONTROL_OUTPUT_KEYS = new Set(['needMore', 'nextRead', 'nextReadParams', 'reason', 'evidence']);

export type DecisionModelRun = (options: {
  requireDeclaredFields: boolean;
  final: boolean;
}) => Promise<DecisionModelOutput>;

export type DecisionModelOutput = Record<string, unknown> & {
  needMore?: boolean;
  nextRead?: string;
  nextReadParams?: unknown;
  conclusion?: string;
};

export interface DecisionLoopContext {
  readonly step: Step & { type: 'ai_decision' };
  readonly ir: WorkflowIR;
  readonly ctx: ConnectorContext;
  readonly stepResults: Record<string, unknown>;
  readonly connectors: Record<string, Connector>;
  readonly allowReads: boolean;
  readonly maxReads: number;
  readonly evidence: Array<{ source: string; detail: string }>;
  readonly documentRequired: boolean;
  readonly runModel: DecisionModelRun;
}

export async function runAiDecisionLoop({
  step,
  ir,
  ctx,
  stepResults,
  connectors,
  allowReads,
  maxReads,
  evidence,
  documentRequired,
  runModel,
}: DecisionLoopContext): Promise<void> {
  let reads = 0;
  while (reads < maxReads) {
    const output = await runModel({ requireDeclaredFields: !allowReads, final: false });

    if (allowReads && output.needMore && output.nextRead) {
      reads++;
      const readResult = await performCapabilityRead(
        output.nextRead,
        ctx,
        connectors,
        (output.nextReadParams as Record<string, unknown> | undefined) ?? {},
      );
      evidence.push({ source: output.nextRead, detail: JSON.stringify(readResult).slice(0, 500) });
      continue;
    }

    if (output.conclusion || Object.keys(output).some((key) => !CONTROL_OUTPUT_KEYS.has(key))) {
      if (allowReads && !hasRequiredOutputFields(step, output)) {
        await persistFinalOutput({ step, ir, ctx, stepResults, evidence, documentRequired, runModel });
        return;
      }
      persistOutput({ step, ir, ctx, stepResults, evidence, documentRequired, output });
      return;
    }

    if (allowReads && requiredOutputFields(step).length > 0 && !hasRequiredOutputFields(step, output)) {
      await persistFinalOutput({ step, ir, ctx, stepResults, evidence, documentRequired, runModel });
      return;
    }

    persistOutput({ step, ir, ctx, stepResults, evidence, documentRequired, output });
    return;
  }

  const output = await runModel({ requireDeclaredFields: true, final: true });
  if (output.conclusion?.trim() && output.conclusion.trim() !== INVESTIGATION_LIMIT_MESSAGE) {
    persistOutput({ step, ir, ctx, stepResults, evidence, documentRequired, output });
    return;
  }
  throw Object.assign(new Error(`AI 판단 단계 ${step.id}가 유효한 결과를 반환하지 않았습니다.`), {
    code: 'ai_output_missing',
  });
}

async function persistFinalOutput(context: {
  step: Step & { type: 'ai_decision' };
  ir: WorkflowIR;
  ctx: ConnectorContext;
  stepResults: Record<string, unknown>;
  evidence: Array<{ source: string; detail: string }>;
  documentRequired: boolean;
  runModel: DecisionModelRun;
}): Promise<void> {
  const output = await context.runModel({ requireDeclaredFields: true, final: true });
  if (!hasRequiredOutputFields(context.step, output)) {
    throw Object.assign(
      new Error(`AI 판단 단계 ${context.step.id}가 선언된 출력 필드를 모두 반환하지 않았습니다.`),
      { code: 'ai_output_missing' },
    );
  }
  persistOutput({ ...context, output });
}

function persistOutput(context: {
  step: Step & { type: 'ai_decision' };
  ir: WorkflowIR;
  ctx: ConnectorContext;
  stepResults: Record<string, unknown>;
  evidence: Array<{ source: string; detail: string }>;
  documentRequired: boolean;
  output: Record<string, unknown>;
}): void {
  persistDecisionOutput(
    context.step,
    context.output,
    context.ctx,
    context.stepResults,
    hasDecisionEvidenceFromBindings(
      context.step,
      context.ir,
      context.ctx,
      context.stepResults,
      context.evidence,
    ),
    context.documentRequired,
  );
}
