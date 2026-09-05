import type { Connector, ConnectorContext } from '../../modules/types.js';
import type { InvestigationRunner } from '../../agent/investigation-runner.js';
import { isCloudProvider } from '../../agent/harness.js';
import type { WorkflowIR, Step } from '../../workflow/schema.js';
import { resolveAiDecisionBindings } from '../../workflow/bindings.js';
import {
  emailBodyFromRun,
  visionInputsFromRun,
} from './input.js';
import { investigationUserPrompt } from './prompt.js';
import {
  cloudDataAllowedForDecision,
  hasDecisionEvidenceFromBindings,
  workflowNeedsDocumentEvidence,
} from './evidence.js';
import { investigationSchemaFor } from './output.js';
import { runAiDecisionLoop, type DecisionModelOutput, type DecisionModelRun } from './decision-loop.js';

export async function runAiDecision(
  step: Step & { type: 'ai_decision' },
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  investigationRunner: InvestigationRunner | undefined,
  connectors: Record<string, Connector>,
): Promise<void> {
  const allowReads = step.investigation === true;
  const maxReads = allowReads ? (step.maxReads ?? 4) : 1;
  const evidence: Array<{ source: string; detail: string }> = [];
  const boundContext = resolveAiDecisionBindings(step, ir, stepResults, ctx.variables, ctx.outputs);
  const untrustedBody =
    boundContext.usesExplicitBindings
      ? boundContext.emailBody
      : emailBodyFromRun(ctx.variables, stepResults);

  if (!investigationRunner) {
    throw Object.assign(new Error(`AI 판단 단계 ${step.id}를 실행할 조사 실행기가 없습니다.`), {
      code: 'agent_unavailable',
    });
  }

  const documentRequired = workflowNeedsDocumentEvidence(ir, step);
  const emailBodyRequired = Boolean(untrustedBody?.trim());
  const cloudAllowed = cloudDataAllowedForDecision(ir, {
    document: documentRequired,
    emailBody: emailBodyRequired,
  });
  const includeSensitiveData = cloudAllowed || !isCloudProvider(investigationRunner.providerName);
  const documentEvidenceAvailable = hasDecisionEvidenceFromBindings(step, ir, ctx, stepResults, evidence);
  if (documentRequired && !includeSensitiveData) {
    throw Object.assign(
      new Error(
        `PDF 분석을 위해 문서 내용이 ${investigationRunner.providerName}에 전달되어야 하지만 현재 차단되었습니다. ` +
          '로컬 AI provider를 사용하거나 workflow.dataPolicy.document.cloudAllowed=true를 명시한 뒤 다시 실행하세요.',
      ),
      {
        code: 'ai_input_unavailable',
      },
    );
  }
  if (documentRequired && includeSensitiveData && !documentEvidenceAvailable) {
    throw Object.assign(new Error('문서 분석에 사용할 PDF 근거가 없습니다.'), {
      code: 'ai_evidence_missing',
    });
  }
  const visionImages = includeSensitiveData
    ? await visionInputsFromRun(ctx.variables, stepResults)
    : [];
  const visionNote = visionImages.length > 0
    ? `실제 이미지 바이트가 첨부된 PDF 페이지: ${visionImages.map((image) => image.pageIndex ?? '?').join(', ')}`
    : undefined;
  const promptFor = (extra?: string) => investigationUserPrompt(
    step,
    ctx,
    stepResults,
    ir,
    [extra, visionNote].filter(Boolean).join('\n\n') || undefined,
    includeSensitiveData,
  );
  ctx.log({
    at: new Date().toISOString(),
    level: 'info',
    code: 'ai_decision_started',
    message: `AI 분석 시작: ${step.id}`,
    data: {
      stepId: step.id,
      provider: investigationRunner.providerName,
      documentRequired,
      sensitiveDataIncluded: includeSensitiveData,
      imageCount: visionImages.length,
    },
  });

  const modelContext = {
    skillGoal: ir.goal,
    taskGoal: step.goal,
    taskMemo: step.memo,
    evidence,
    connectedConnectors: Object.keys(connectors),
    untrustedData: untrustedBody,
  };
  const runModel: DecisionModelRun = async ({ requireDeclaredFields, final }) => {
    const { output } = await investigationRunner.run({
      outputSchema: investigationSchemaFor(step, requireDeclaredFields),
      user: promptFor(final ? '추가 조회 없이 지금 결론을 내리고 선언된 출력 필드를 모두 채우세요.' : undefined),
      images: visionImages.length > 0 ? visionImages : undefined,
      cloudAllowed,
      context: modelContext,
    });
    return output as DecisionModelOutput;
  };
  await runAiDecisionLoop({
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
  });
}
