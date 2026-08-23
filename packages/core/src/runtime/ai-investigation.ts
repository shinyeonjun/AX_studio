import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Connector, ConnectorContext } from '../modules/types.js';
import type { AgentHarness } from '../agent/harness.js';
import { z } from 'zod';
import { extractGmailPlainBody } from '../modules/gmail/body-extract.js';
import { performCapabilityRead } from './capability-read.js';
import { evaluateCondition } from './condition-expr.js';
import { InvestigationOutputSchema } from './investigation-schema.js';
import { isCloudProvider } from '../agent/cloud.js';
import type { WorkflowIR, Step } from '../workflow/schema.js';
import type { ModelImageInput } from '../agent/model/provider.js';

export { evaluateCondition } from './condition-expr.js';

const INVESTIGATION_LIMIT_MESSAGE = 'Max investigation reads reached';
const MAX_UNTRUSTED_EMAIL_CHARS = 12_000;
const MAX_UNTRUSTED_METADATA_CHARS = 2_000;
const MAX_OUTPUT_PREVIEW_FIELDS = 16;
const MAX_OUTPUT_PREVIEW_CHARS = 400;

function truncateModelInput(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars
    ? `${trimmed.slice(0, maxChars)}\n...[이하 생략]`
    : trimmed;
}

function previewOutputValue(value: unknown): string {
  if (typeof value === 'string') return truncateModelInput(value, MAX_OUTPUT_PREVIEW_CHARS);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return truncateModelInput(JSON.stringify(value), MAX_OUTPUT_PREVIEW_CHARS);
  } catch {
    return '[표시할 수 없는 값]';
  }
}

function previewDecisionOutput(output: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(output)
      .slice(0, MAX_OUTPUT_PREVIEW_FIELDS)
      .map(([key, value]) => [key, previewOutputValue(value)]),
  );
}

function documentTextFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): string | undefined {
  for (const key of ['transformText', 'documentText', 'text', 'body']) {
    const value = variables[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  for (const result of Object.values(stepResults).reverse()) {
    if (typeof result === 'string' && result.trim()) return result;
    if (!result || typeof result !== 'object') continue;
    const record = result as Record<string, unknown>;
    for (const key of ['text', 'body', 'summary']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim() && candidate !== INVESTIGATION_LIMIT_MESSAGE) {
        return candidate;
      }
    }
  }
  return undefined;
}

function documentVisualsFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): string | undefined {
  const lines: string[] = [];
  const seen = new Set<string>();

  const addVisual = (pageIndex: unknown, path: unknown, ocrText: unknown, hasVisual = false) => {
    const page = Number.isInteger(pageIndex) ? String(pageIndex) : '?';
    const imagePath = typeof path === 'string' && path.trim() ? path.trim() : '';
    const ocr = typeof ocrText === 'string' && ocrText.trim() ? ocrText.trim() : '';
    const key = `${page}|${imagePath}|${ocr}`;
    if (!imagePath && !ocr && !hasVisual) return;
    if (seen.has(key)) return;
    seen.add(key);
    const availability = ocr ? 'ocr_only' : 'visual_content_unavailable';
    lines.push(
      `- page=${page}${imagePath ? ` path=${imagePath}` : ''}${ocr ? ` OCR=${ocr}` : ''} visualContent=${availability}`,
    );
  };

  const scanArtifact = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.images)) {
      for (const image of record.images) {
        if (!image || typeof image !== 'object' || Array.isArray(image)) continue;
        const item = image as Record<string, unknown>;
        addVisual(item.pageIndex, item.path, item.ocrText);
      }
    }
    if (Array.isArray(record.pages)) {
      for (const page of record.pages) {
        if (!page || typeof page !== 'object' || Array.isArray(page)) continue;
        const item = page as Record<string, unknown>;
        if (item.hasVisual === true) addVisual(item.index, item.imagePath, item.text, true);
      }
    }
  };

  Object.values(variables).forEach(scanArtifact);
  Object.values(stepResults).forEach(scanArtifact);
  return lines.length > 0 ? lines.join('\n').slice(0, 8_000) : undefined;
}

interface DocumentVisualReference {
  pageIndex?: number;
  path: string;
}

function documentVisualReferencesFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): DocumentVisualReference[] {
  const references: DocumentVisualReference[] = [];
  const seen = new Set<string>();
  const add = (pageIndex: unknown, path: unknown) => {
    if (typeof path !== 'string' || !path.trim()) return;
    const normalized = path.trim();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    references.push({
      pageIndex: Number.isInteger(pageIndex) ? Number(pageIndex) : undefined,
      path: normalized,
    });
  };

  const scanArtifact = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.images)) {
      for (const image of record.images) {
        if (!image || typeof image !== 'object' || Array.isArray(image)) continue;
        const item = image as Record<string, unknown>;
        add(item.pageIndex, item.path);
      }
    }
    if (Array.isArray(record.pages)) {
      for (const page of record.pages) {
        if (!page || typeof page !== 'object' || Array.isArray(page)) continue;
        const item = page as Record<string, unknown>;
        if (item.hasVisual === true) add(item.index, item.imagePath);
      }
    }
  };

  Object.values(variables).forEach(scanArtifact);
  Object.values(stepResults).forEach(scanArtifact);
  return references;
}

function imageMimeType(path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }[extension];
}

async function visionInputsFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): Promise<ModelImageInput[]> {
  const references = documentVisualReferencesFromRun(variables, stepResults);
  const images: ModelImageInput[] = [];
  let totalBytes = 0;
  const maxImageBytes = 8 * 1024 * 1024;
  const maxTotalBytes = 32 * 1024 * 1024;

  for (const reference of references) {
    const mimeType = imageMimeType(reference.path);
    if (!mimeType) {
      throw Object.assign(new Error(`지원하지 않는 PDF 이미지 형식입니다: ${reference.path}`), {
        code: 'vision_unsupported_media',
        path: reference.path,
      });
    }
    let data: Buffer;
    try {
      data = await readFile(reference.path);
    } catch (error) {
      throw Object.assign(new Error(`PDF 시각 아티팩트 이미지를 읽을 수 없습니다: ${reference.path}`), {
        code: 'vision_asset_unavailable',
        path: reference.path,
        cause: error,
      });
    }
    if (data.length === 0 || data.length > maxImageBytes || totalBytes + data.length > maxTotalBytes) {
      throw Object.assign(new Error(`PDF 시각 입력 크기가 허용 범위를 초과했습니다: ${reference.path}`), {
        code: 'vision_input_too_large',
        path: reference.path,
      });
    }
    totalBytes += data.length;
    images.push({
      data: new Uint8Array(data),
      mimeType,
      pageIndex: reference.pageIndex,
      filename: basename(reference.path),
    });
  }
  return images;
}

function emailBodyFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): string | undefined {
  for (const result of Object.values(stepResults)) {
    const body = extractGmailPlainBody(result);
    if (body?.trim()) return truncateModelInput(body, MAX_UNTRUSTED_EMAIL_CHARS);
  }
  const snippet = variables.snippet ?? variables.body ?? variables.text;
  return snippet != null ? truncateModelInput(String(snippet), MAX_UNTRUSTED_EMAIL_CHARS) : undefined;
}

export function buildInvestigationUser(
  step: Step & { type: 'ai_decision' },
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  options: { includeSensitiveData?: boolean } = {},
): string {
  const lines = [`Task: ${step.goal}`];
  if (step.memo?.trim()) {
    lines.push(`Criteria:\n${step.memo.trim()}`);
  }
  if (options.includeSensitiveData === false) return lines.join('\n\n');
  if (ctx.variables.subject) {
    lines.push(`Subject: ${truncateModelInput(String(ctx.variables.subject), MAX_UNTRUSTED_METADATA_CHARS)}`);
  }
  const from = ctx.variables.from ?? ctx.variables.sender;
  if (from) lines.push(`From: ${truncateModelInput(String(from), MAX_UNTRUSTED_METADATA_CHARS)}`);
  const body = emailBodyFromRun(ctx.variables, stepResults);
  if (body) lines.push(`Body:\n${body}`);
  const documentText = documentTextFromRun(ctx.variables, stepResults);
  if (documentText && documentText !== body) {
    lines.push(`Document:\n${documentText.slice(0, 12_000)}`);
  }
  const documentVisuals = documentVisualsFromRun(ctx.variables, stepResults);
  if (documentVisuals) {
    lines.push(`Document visuals (image paths/OCR metadata):\n${documentVisuals}`);
  }
  return lines.join('\n\n');
}

function mapInvestigationOutput(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
): Record<string, unknown> {
  return { ...output };
}

function investigationSchemaFor(
  step: Step & { type: 'ai_decision' },
  requireDeclaredFields = true,
): z.ZodTypeAny {
  const properties = step.outputSchema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return InvestigationOutputSchema;
  }

  const required = new Set(
    Array.isArray(step.outputSchema?.required)
      ? requireDeclaredFields
        ? step.outputSchema.required.filter((value): value is string => typeof value === 'string')
        : []
      : [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, definition] of Object.entries(properties)) {
    const type = definition && typeof definition === 'object' && !Array.isArray(definition)
      ? (definition as Record<string, unknown>).type
      : undefined;
    const enumValues = definition && typeof definition === 'object' && !Array.isArray(definition)
      ? (definition as Record<string, unknown>).enum
      : undefined;
    let field: z.ZodTypeAny =
      Array.isArray(enumValues) && enumValues.every((value) => typeof value === 'string')
        ? z.enum(enumValues as [string, ...string[]]) :
      type === 'string' ? z.string() :
      type === 'number' || type === 'integer' ? z.number() :
      type === 'boolean' ? z.boolean() :
      type === 'array' ? z.array(z.unknown()) :
      z.unknown();
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }
  return InvestigationOutputSchema.extend(shape);
}

function requiredOutputFields(step: Step & { type: 'ai_decision' }): string[] {
  return Array.isArray(step.outputSchema?.required)
    ? step.outputSchema.required.filter((value): value is string => typeof value === 'string')
    : [];
}

function workflowNeedsDocumentEvidence(ir: WorkflowIR): boolean {
  return ir.steps.some(
    (candidate) =>
      candidate.type === 'action' &&
      candidate.connector === 'document' &&
      candidate.action === 'ingest',
  );
}

function cloudDataAllowedForDecision(
  ir: WorkflowIR,
  requirements: { document: boolean; emailBody: boolean },
): boolean {
  const requiredPolicies = [
    requirements.document ? ir.dataPolicy?.document?.cloudAllowed !== false : true,
    requirements.emailBody ? ir.dataPolicy?.emailBody?.cloudAllowed !== false : true,
  ];
  return requiredPolicies.every(Boolean);
}

function hasDecisionEvidence(
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  evidence: Array<{ source: string; detail: string }>,
): boolean {
  return Boolean(
    evidence.length > 0 ||
      emailBodyFromRun(ctx.variables, stepResults)?.trim() ||
      documentTextFromRun(ctx.variables, stepResults)?.trim() ||
      documentVisualReferencesFromRun(ctx.variables, stepResults).length > 0,
  );
}

function validateDecisionEvidence(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
  evidenceAvailable: boolean,
  evidenceRequired: boolean,
): void {
  const properties = step.outputSchema?.properties;
  const declaresRiskLevel = Boolean(
    properties &&
      typeof properties === 'object' &&
      !Array.isArray(properties) &&
      'riskLevel' in properties,
  ) || 'riskLevel' in output;
  if (!declaresRiskLevel) return;

  if (evidenceRequired && !evidenceAvailable) {
    throw Object.assign(new Error(`AI 판단 단계 ${step.id}에 분석 근거가 없습니다.`), {
      code: 'ai_evidence_missing',
    });
  }

  const category = output.category;
  const confidence = output.confidence;
  if (category === 'undetermined' || (typeof confidence === 'number' && confidence <= 0)) {
    throw Object.assign(new Error(`AI 판단 단계 ${step.id}가 근거 부족 결과를 반환했습니다.`), {
      code: 'ai_output_undetermined',
    });
  }
}

function persistDecisionOutput(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  evidenceAvailable: boolean,
  evidenceRequired: boolean,
): void {
  validateDecisionEvidence(step, output, evidenceAvailable, evidenceRequired);
  stepResults[step.id] = mapInvestigationOutput(step, output);
  const declaredOutputFields =
    step.outputSchema?.properties && typeof step.outputSchema.properties === 'object'
      ? Object.keys(step.outputSchema.properties)
      : [];
  const missingOutputFields = requiredOutputFields(step).filter((field) => output[field] == null);
  ctx.log({
    at: new Date().toISOString(),
    level: 'info',
    code: 'ai_decision_completed',
    message: `AI 분석 완료: ${step.id}`,
    data: {
      stepId: step.id,
      evidenceAvailable,
      outputFields: Object.keys(output),
      declaredOutputFields,
      missingOutputFields,
      outputPreview: previewDecisionOutput(output),
      riskLevel: typeof output.riskLevel === 'string' ? output.riskLevel : undefined,
      confidence: typeof output.confidence === 'number' ? output.confidence : undefined,
    },
  });
}

function hasRequiredOutputFields(
  step: Step & { type: 'ai_decision' },
  output: Record<string, unknown>,
): boolean {
  return requiredOutputFields(step).every((field) => output[field] != null);
}

function investigationUserPrompt(
  step: Step & { type: 'ai_decision' },
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  extra?: string,
  includeSensitiveData = true,
): string {
  const base = buildInvestigationUser(step, ctx, stepResults, { includeSensitiveData });
  if (!step.investigation) {
    return `${base}\n\n추가 조회 없이 지금 결론만 내세요. needMore는 false로 두세요.`;
  }
  return extra ? `${base}\n\n${extra}` : base;
}

export async function runAiDecision(
  step: Step & { type: 'ai_decision' },
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  agentHarness: AgentHarness | undefined,
  connectors: Record<string, Connector>,
): Promise<void> {
  const allowReads = step.investigation === true;
  const maxReads = allowReads ? (step.maxReads ?? 4) : 1;
  let reads = 0;
  const evidence: Array<{ source: string; detail: string }> = [];
  const untrustedBody = emailBodyFromRun(ctx.variables, stepResults);

  if (!agentHarness) {
    throw Object.assign(new Error(`AI 판단 단계 ${step.id}를 실행할 Agent Harness가 없습니다.`), {
      code: 'agent_unavailable',
    });
  }

  const documentRequired = workflowNeedsDocumentEvidence(ir);
  const emailBodyRequired = Boolean(untrustedBody?.trim());
  const cloudAllowed = cloudDataAllowedForDecision(ir, {
    document: documentRequired,
    emailBody: emailBodyRequired,
  });
  const includeSensitiveData = cloudAllowed || !isCloudProvider(agentHarness.providerName);
  const documentEvidenceAvailable = hasDecisionEvidence(ctx, stepResults, evidence);
  if (documentRequired && !includeSensitiveData) {
    throw Object.assign(
      new Error(
        `PDF 분석을 위해 문서 내용이 ${agentHarness.providerName}에 전달되어야 하지만 현재 차단되었습니다. ` +
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
      provider: agentHarness.providerName,
      documentRequired,
      sensitiveDataIncluded: includeSensitiveData,
      imageCount: visionImages.length,
    },
  });

  const runFinalConclusion = async () => {
    const { output } = await agentHarness.run({
      role: 'investigate',
      outputSchema: investigationSchemaFor(step, true),
      user: promptFor('추가 조회 없이 지금 결론을 내리고 선언된 출력 필드를 모두 채우세요.'),
      images: visionImages.length > 0 ? visionImages : undefined,
      cloudAllowed,
      context: {
        skillGoal: ir.goal,
        taskGoal: step.goal,
        taskMemo: step.memo,
        evidence,
        connectedConnectors: Object.keys(connectors),
        untrustedData: untrustedBody,
      },
    });
    return output;
  };

  while (reads < maxReads) {
    {
      const { output } = await agentHarness.run({
        role: 'investigate',
        outputSchema: investigationSchemaFor(step, !allowReads),
        user: promptFor(),
        images: visionImages.length > 0 ? visionImages : undefined,
        cloudAllowed,
        context: {
          skillGoal: ir.goal,
          taskGoal: step.goal,
          taskMemo: step.memo,
          evidence,
          connectedConnectors: Object.keys(connectors),
          untrustedData: untrustedBody,
        },
      });

      if (allowReads && output.needMore && output.nextRead) {
        reads++;
        const readResult = await performCapabilityRead(
          output.nextRead,
          ctx,
          connectors,
          (output.nextReadParams as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>),
        );
        evidence.push({ source: output.nextRead, detail: JSON.stringify(readResult).slice(0, 500) });
        continue;
      }

      if (output.conclusion || Object.keys(output).some((key) => !['needMore', 'nextRead', 'nextReadParams', 'reason', 'evidence'].includes(key))) {
        if (allowReads && !hasRequiredOutputFields(step, output)) {
          const finalOutput = await runFinalConclusion();
          if (!hasRequiredOutputFields(step, finalOutput)) {
            throw Object.assign(new Error(`AI 판단 단계 ${step.id}가 선언된 출력 필드를 모두 반환하지 않았습니다.`), {
              code: 'ai_output_missing',
            });
          }
          persistDecisionOutput(
            step,
            finalOutput,
            ctx,
            stepResults,
            hasDecisionEvidence(ctx, stepResults, evidence),
            documentRequired,
          );
          return;
        }
        persistDecisionOutput(
          step,
          output,
          ctx,
          stepResults,
          hasDecisionEvidence(ctx, stepResults, evidence),
          documentRequired,
        );
        return;
      }

      if (allowReads && requiredOutputFields(step).length > 0 && !hasRequiredOutputFields(step, output)) {
        const finalOutput = await runFinalConclusion();
        if (!hasRequiredOutputFields(step, finalOutput)) {
          throw Object.assign(new Error(`AI 판단 단계 ${step.id}가 선언된 출력 필드를 모두 반환하지 않았습니다.`), {
            code: 'ai_output_missing',
          });
        }
        persistDecisionOutput(
          step,
          finalOutput,
          ctx,
          stepResults,
          hasDecisionEvidence(ctx, stepResults, evidence),
          documentRequired,
        );
        return;
      }

      persistDecisionOutput(
        step,
        output,
        ctx,
        stepResults,
        hasDecisionEvidence(ctx, stepResults, evidence),
        documentRequired,
      );
      return;
    }
  }

  {
    const output = await runFinalConclusion();
    if (output.conclusion?.trim() && output.conclusion.trim() !== INVESTIGATION_LIMIT_MESSAGE) {
      persistDecisionOutput(
        step,
        output,
        ctx,
        stepResults,
        hasDecisionEvidence(ctx, stepResults, evidence),
        documentRequired,
      );
      return;
    }
  }
  throw Object.assign(new Error(`AI 판단 단계 ${step.id}가 유효한 결과를 반환하지 않았습니다.`), {
    code: 'ai_output_missing',
  });
}

// Backward-compatible export for callers that used the previous combined
// module. The implementation lives in the parameter-resolution boundary.
export { resolveStepParams } from './param-resolution.js';
