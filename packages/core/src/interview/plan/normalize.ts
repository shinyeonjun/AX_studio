import { parseJsonRecordValue } from '../draft/schema.js';

export type PlanNodeType = 'action' | 'ai_decision' | 'if' | 'human_approval';

export type NormalizedOutputField = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  enumValues?: string[];
};

function mapJsonSchemaType(type: unknown): NormalizedOutputField['type'] {
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') return 'array';
  return 'string';
}

function fieldFromDefinition(name: string, def: unknown): NormalizedOutputField {
  if (def && typeof def === 'object' && !Array.isArray(def)) {
    const record = def as Record<string, unknown>;
    return {
      name,
      type: mapJsonSchemaType(record.type),
      description: typeof record.description === 'string' ? record.description : name,
      ...(Array.isArray(record.enum) ? { enumValues: record.enum.map(String) } : {}),
    };
  }
  return { name, type: 'string', description: name };
}

/** Accept array, JSON string, JSON-schema object, or field map from CLI models. */
export function parseOutputFields(value: unknown): NormalizedOutputField[] | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string') {
    return parseOutputFields(parseJsonRecordValue(value));
  }
  if (Array.isArray(value)) {
    const fields: NormalizedOutputField[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.name !== 'string') continue;
      fields.push({
        name: record.name,
        type: mapJsonSchemaType(record.type),
        description: typeof record.description === 'string' ? record.description : record.name,
        ...(Array.isArray(record.enumValues)
          ? { enumValues: record.enumValues.map(String) }
          : Array.isArray(record.enum)
            ? { enumValues: record.enum.map(String) }
            : {}),
      });
    }
    return fields.length > 0 ? fields : undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
      return parseOutputFields(record.properties);
    }
    const fields = Object.entries(record).map(([name, def]) => fieldFromDefinition(name, def));
    return fields.length > 0 ? fields : undefined;
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value == null || value === '') return undefined;
  if (Array.isArray(value)) {
    return value.map(String).filter((item) => item.trim().length > 0);
  }
  if (typeof value === 'string') {
    const parsed = parseJsonRecordValue(value);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.values(parsed as Record<string, unknown>).map(String);
    }
  }
  return undefined;
}

export function inferPlanNodeType(node: Record<string, unknown>): PlanNodeType | undefined {
  const explicit = node.type;
  if (explicit === 'action' || explicit === 'ai_decision' || explicit === 'if' || explicit === 'human_approval') {
    return explicit;
  }
  if (node.forActionIds != null || typeof node.reason === 'string') return 'human_approval';
  if (node.condition != null || node.thenStepIds != null || node.elseStepIds != null) return 'if';
  if (
    typeof node.goal === 'string' ||
    node.outputFields != null ||
    node.outputSchema != null ||
    node.investigation != null
  ) {
    return 'ai_decision';
  }
  if (node.actionRef || node.connector || node.action || node.params != null) return 'action';
  return undefined;
}

function inferNodeId(node: Record<string, unknown>, index: number): string | undefined {
  for (const key of ['id', 'stepId', 'nodeId', 'name'] as const) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const type = inferPlanNodeType(node);
  if (!type) return undefined;
  return `${type}_${index + 1}`;
}

export function normalizePlanNode(raw: unknown, index = 0): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  let value: unknown = raw;
  if (typeof value === 'string') {
    value = parseJsonRecordValue(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const record = { ...(value as Record<string, unknown>) };
  const type = inferPlanNodeType(record);
  if (!type) return undefined;

  const id = inferNodeId(record, index);
  if (!id) return undefined;

  record.id = id;
  record.type = type;

  if (record.outputSchema != null && record.outputFields == null) {
    record.outputFields = parseOutputFields(record.outputSchema);
    delete record.outputSchema;
  } else if (record.outputFields != null) {
    record.outputFields = parseOutputFields(record.outputFields);
  }

  const thenStepIds = parseStringArray(record.thenStepIds);
  if (thenStepIds) record.thenStepIds = thenStepIds;
  const elseStepIds = parseStringArray(record.elseStepIds);
  if (elseStepIds) record.elseStepIds = elseStepIds;
  const forActionIds = parseStringArray(record.forActionIds);
  if (forActionIds) record.forActionIds = forActionIds;

  return record;
}

export function normalizePlanNodes(nodes: unknown): unknown[] {
  if (typeof nodes === 'string') {
    try {
      nodes = JSON.parse(nodes);
    } catch {
      nodes = parseJsonRecordValue(nodes);
    }
  }
  if (!Array.isArray(nodes)) return [];
  const normalized: unknown[] = [];
  nodes.forEach((node, index) => {
    const next = normalizePlanNode(node, index);
    // Preserve malformed entries so WorkflowPlanSchema rejects the plan with
    // a precise contract error instead of silently deleting graph nodes.
    normalized.push(next ?? node);
  });
  return normalized;
}

export function normalizePlanPayload(value: unknown): unknown {
  if (value == null) return value;
  let record: unknown = value;
  if (typeof record === 'string') {
    record = parseJsonRecordValue(record);
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return value;
  const next = { ...(record as Record<string, unknown>) };
  if ('nodes' in next) {
    next.nodes = normalizePlanNodes(next.nodes);
  }
  return next;
}
