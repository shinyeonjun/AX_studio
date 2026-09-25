import type { Connector, ConnectorContext } from '../../connectors/types.js';
import type { DecisionEngine } from '../../contracts/decision.js';
import type { InvestigationRunner } from '../../intelligence/agent/investigation-runner.js';
import { isCloudProvider } from '../../intelligence/agent/harness.js';
import type { WorkflowIR, Step } from '../../workflow/schema.js';
import { resolveAiDecisionBindings } from '../../workflow/bindings.js';
import {
  buildInvestigationUser,
  emailBodyFromRun,
  visionInputsFromRun,
} from './input.js';
import { investigationUserPrompt } from './prompt.js';
import {
  cloudDataAllowedForReadSource,
  cloudDataAllowedForDecision,
  hasDecisionEvidenceFromBindings,
  workflowNeedsDocumentEvidence,
} from './evidence.js';
import { investigationSchemaFor } from './output.js';
import { runAiDecisionLoop, type DecisionModelOutput, type DecisionModelRun } from './decision-loop.js';

function stepForModelFields(
  step: Step & { type: 'ai_decision' },
  outputFields?: string[],
): Step & { type: 'ai_decision' } {
  const outputSchema = step.outputSchema;
  const properties = outputSchema?.properties;
  if (!outputFields || !outputSchema || !properties || typeof properties !== 'object' || Array.isArray(properties)) return step;
  const selected = new Set(outputFields);
  return {
    ...step,
    outputSchema: {
      ...outputSchema,
      properties: Object.fromEntries(Object.entries(properties).filter(([field]) => selected.has(field))),
      ...(Array.isArray(outputSchema.required)
        ? { required: outputSchema.required.filter((field): field is string => typeof field === 'string' && selected.has(field)) }
        : {}),
    },
  };
}

export async function runAiDecision(
  step: Step & { type: 'ai_decision' },
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  investigationRunner: InvestigationRunner | undefined,
  connectors: Record<string, Connector>,
  decisionEngine?: DecisionEngine,
): Promise<void> {
  const allowReads = step.investigation === true;
  const maxReads = allowReads ? step.maxReads : undefined;
  const evidence: Array<{ source: string; detail: string }> = [];
  const boundContext = resolveAiDecisionBindings(step, ir, stepResults, ctx.variables, ctx.outputs);
  const untrustedBody =
    boundContext.usesExplicitBindings
      ? boundContext.emailBody
      : emailBodyFromRun(ctx.variables, stepResults);

  if (!investigationRunner && !decisionEngine) {
    throw Object.assign(new Error(`AI 판단 단계 ${step.id}를 실행할 조사 실행기가 없습니다.`), {
      code: 'agent_unavailable',
    });
  }

  const documentRequired = workflowNeedsDocumentEvidence(ir, step);
  const emailBodyRequired = Boolean(untrustedBody?.trim());
  const boundInputPorts = Object.entries(boundContext.bound)
    .filter(([port, value]) => value != null && !['document', 'emailBody'].includes(port))
    .map(([port]) => port);
  const restrictedBoundInputPorts = boundInputPorts.filter((port) => ir.dataPolicy?.[port]?.cloudAllowed === false);
  const cloudAllowed = cloudDataAllowedForDecision(ir, {
    document: documentRequired,
    emailBody: emailBodyRequired,
    boundInputPorts,
  });
  const cloudProvider = investigationRunner ? isCloudProvider(investigationRunner.providerName) : true;
  const includeSensitiveData = cloudAllowed || Boolean(investigationRunner && !cloudProvider);
  if (restrictedBoundInputPorts.length > 0 && cloudProvider) {
    throw Object.assign(
      new Error(`입력 데이터(${restrictedBoundInputPorts.join(', ')})의 클라우드 전송이 workflow.dataPolicy에서 차단되었습니다.`),
      { code: 'ai_input_unavailable' },
    );
  }
  const documentEvidenceAvailable = hasDecisionEvidenceFromBindings(step, ir, ctx, stepResults, evidence);
  if (documentRequired && !includeSensitiveData) {
    const providerName = investigationRunner?.providerName ?? 'Jev';
    throw Object.assign(
      new Error(
        `PDF 분석을 위해 문서 내용이 ${providerName}에 전달되어야 하지만 현재 차단되었습니다. ` +
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
  const visionImages = includeSensitiveData && investigationRunner
    ? await visionInputsFromRun(ctx.variables, stepResults)
    : [];
  const visionNote = visionImages.length > 0
    ? `실제 이미지 바이트가 첨부된 PDF 페이지: ${visionImages.map((image) => image.pageIndex ?? '?').join(', ')}`
    : undefined;
  const outputDecisionEngine = (cloudAllowed || decisionEngine?.dataHandling === 'local') && visionImages.length === 0
    ? decisionEngine
    : undefined;
  const decisionInput = outputDecisionEngine
    ? buildInvestigationUser(step, ctx, stepResults, {
        includeSensitiveData: true,
        includeDocumentVisuals: false,
        ir,
      })
    : '';
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
      provider: investigationRunner?.providerName ?? (outputDecisionEngine ? 'jev' : 'none'),
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
  const runModel: DecisionModelRun | undefined = investigationRunner
    ? async ({ requireDeclaredFields, final, outputFields, decisionValues }) => {
        const modelStep = stepForModelFields(step, outputFields);
        const restrictedReadSources = [...new Set(evidence
          .map((item) => item.source)
          .filter((source) => !cloudDataAllowedForReadSource(ir, source)))];
        if (cloudProvider && restrictedReadSources.length > 0) {
          throw Object.assign(
            new Error(`연결 자료(${restrictedReadSources.join(', ')})의 클라우드 전송이 workflow.dataPolicy에서 차단되었습니다.`),
            { code: 'ai_input_unavailable', data: { stepId: step.id, sources: restrictedReadSources } },
          );
        }
        const jevValues = decisionValues && Object.keys(decisionValues).length > 0
          ? `Jev가 이미 확정한 구조화 결과(변경하지 말 것): ${JSON.stringify(decisionValues)}`
          : undefined;
        const { output } = await investigationRunner.run({
          outputSchema: investigationSchemaFor(modelStep, requireDeclaredFields),
          user: promptFor([
            final ? '추가 조회 없이 지금 결론을 내리고 선언된 출력 필드를 모두 채우세요.' : undefined,
            jevValues,
          ].filter(Boolean).join('\n\n') || undefined),
          images: visionImages.length > 0 ? visionImages : undefined,
          cloudAllowed: cloudAllowed && evidence.every((item) => cloudDataAllowedForReadSource(ir, item.source)),
          context: modelContext,
        });
        return output as DecisionModelOutput;
      }
    : undefined;
  await runAiDecisionLoop({
    step,
    ir,
    ctx,
    stepResults,
    connectors,
    allowReads,
    maxReads,
    cloudAllowed,
    evidence,
    documentRequired,
    decisionEngine,
    outputDecisionEngine,
    decisionInput,
    runModel,
  });
}
