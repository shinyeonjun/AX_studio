import type { ContractTypeName } from '../contracts/capability-io.js';
import { DocumentArtifactSchema } from '../contracts/artifacts/document.js';
import { FileRefSchema } from '../contracts/artifacts/file-ref.js';
import {
  buildHttpResponseArtifact,
  HttpResponseArtifactSchema,
} from '../contracts/artifacts/http-response.js';
import { JsonArtifactSchema, TextArtifactSchema } from '../contracts/artifacts/text.js';
import { TableArtifactSchema } from '../contracts/artifacts/table.js';
import { tableArtifactFromMatrix, tableArtifactFromRows } from '../contracts/artifacts/table-build.js';

export type StepOutputMap = Record<string, Record<string, unknown>>;

function outputCandidate(port: string, data: unknown, outputCount: number): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (Object.hasOwn(record, port)) return record[port];
  if (outputCount === 1) return data;
  return data;
}

function normalizeOutput(
  type: ContractTypeName,
  value: unknown,
  stepId: string,
  port: string,
): unknown {
  switch (type) {
    case 'TableArtifact': {
      const parsed = TableArtifactSchema.safeParse(value);
      if (parsed.success) return parsed.data;
      const table = tableArtifactFromRows(value, { id: `runtime_${stepId}_${port}` })
        ?? tableArtifactFromMatrix(value, { id: `runtime_${stepId}_${port}` });
      if (table) return table;
      break;
    }
    case 'TextArtifact': {
      const parsed = TextArtifactSchema.safeParse(value);
      if (parsed.success) return parsed.data;
      if (typeof value === 'string') return TextArtifactSchema.parse({ text: value, format: 'plain' });
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const text = ['text', 'body', 'summary']
          .map((key) => record[key])
          .find((candidate): candidate is string => typeof candidate === 'string');
        if (text !== undefined) return TextArtifactSchema.parse({ text, format: 'plain' });
      }
      break;
    }
    case 'JsonArtifact': {
      const parsed = JsonArtifactSchema.safeParse(value);
      if (parsed.success) return parsed.data;
      return JsonArtifactSchema.parse({ value });
    }
    case 'FileRef': {
      const parsed = FileRefSchema.safeParse(value);
      if (parsed.success) return parsed.data;
      break;
    }
    case 'DocumentArtifact': {
      const parsed = DocumentArtifactSchema.safeParse(value);
      if (parsed.success) return parsed.data;
      break;
    }
    case 'HttpResponseArtifact': {
      const parsed = HttpResponseArtifactSchema.safeParse(value);
      if (parsed.success) return parsed.data;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (
          typeof record.status === 'number' &&
          typeof record.statusText === 'string' &&
          typeof record.body === 'string' &&
          typeof record.url === 'string'
        ) {
          return buildHttpResponseArtifact({
            executionId: stepId,
            status: record.status,
            statusText: record.statusText,
            body: record.body,
            url: record.url,
            headers: record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)
              ? Object.fromEntries(Object.entries(record.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
              : {},
            truncated: record.truncated === true,
          });
        }
      }
      break;
    }
    case 'FileCreatedEvent':
    case 'EmailMessageRef':
    case 'SlackChannelRef':
    case 'SlackMessageRef':
    case 'DocumentIngestInput':
      // These contracts have connector-specific shapes today. Preserve the
      // value here while the owning adapter remains responsible for its
      // domain validation.
      return value;
  }

  throw Object.assign(new Error(`출력 포트 계약을 만족하지 않습니다: ${stepId}.${port} (${type})`), {
    code: 'output_contract_invalid',
    data: { stepId, port, expected: type },
  });
}

/** Materialize declared capability outputs once at the runtime seam. */
export function materializeStepOutputs(
  stepId: string,
  outputContracts: Record<string, ContractTypeName> | undefined,
  data: unknown,
): Record<string, unknown> {
  if (!outputContracts) return {};
  const entries = Object.entries(outputContracts);
  return Object.fromEntries(entries.map(([port, type]) => [
    port,
    normalizeOutput(type, outputCandidate(port, data, entries.length), stepId, port),
  ]));
}
